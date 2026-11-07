// End-to-end: loads the unpacked extension into Chromium (with the bundled
// built-in model from vendor/), serves a fake chatgpt.com page so the real
// content scripts inject, and checks pastes, reply reveal and the Ollama path
// (against a mock on the default port). Run `npm run vendor` first.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
import { extractOoxmlText } from '../../src/core/ooxml.js';
import { startMockOllama } from '../helpers/mock-ollama.js';
import { startRecordingProxy, unexpectedHosts } from '../helpers/recording-proxy.js';

// EXTENSION_PATH lets the suite run against an unzipped release package.
const EXTENSION_PATH = process.env.EXTENSION_PATH ?? fileURLToPath(new URL('../../', import.meta.url));
const OLLAMA_PORT = 11434;

// A textarea, a ProseMirror-like editor that handles paste itself, and a
// bare contenteditable that relies on the execCommand fallback.
const FAKE_CHAT_PAGE = `<!doctype html><html><body>
  <textarea id="plain" rows="6" cols="80"></textarea>
  <div id="rich" contenteditable="true" style="min-height:60px;border:1px solid #ccc"></div>
  <div id="bare" contenteditable="true" style="min-height:60px;border:1px solid #ccc"></div>
  <chat-box id="shadow-host"></chat-box>
  <div id="reply"></div>
  <input id="pw" type="password">
  <input id="upload" type="file" multiple>
  <script>
    customElements.define('chat-box', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<textarea id="inner"></textarea>'; }
    });
    window.pageSawRawPaste = false;
    // "Paste anywhere": like chat.mistral.ai, a page-wide handler routes pastes
    // that don't target a text box into the composer.
    document.addEventListener('paste', (e) => {
      if (e.defaultPrevented || e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      const text = e.clipboardData.getData('text/plain');
      if (text.includes('Maria Gonzalez')) window.pageSawRawPaste = true;
      e.preventDefault();
      document.getElementById('plain').value += text;
    });
    document.getElementById('rich').addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (text.includes('Maria Gonzalez')) window.pageSawRawPaste = true;
      e.currentTarget.textContent += text;
    });
    // What the site receives when files are uploaded, dropped or pasted.
    const readFiles = (files) => Promise.all([...files].map(async (f) => ({
      name: f.name, type: f.type, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))),
    })));
    document.getElementById('upload').addEventListener('change', async (e) => { window.uploaded = await readFiles(e.target.files); });
    document.addEventListener('drop', async (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      window.dropped = await readFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', async (e) => {
      if (e.clipboardData.files.length) window.pastedFiles = await readFiles(e.clipboardData.files);
    });
    window.fireFile = (kind, name, text, targetId = 'bare', extra = {}) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: extra.mime ?? 'text/plain' }));
      if (extra.html !== undefined) data.setData('text/html', extra.html);
      const init = { bubbles: true, cancelable: true, composed: true };
      const target = document.getElementById(targetId);
      target.dispatchEvent(kind === 'drop' ? new DragEvent('drop', { ...init, dataTransfer: data }) : new ClipboardEvent('paste', { ...init, clipboardData: data }));
    };
    // A chat reply rendered by the page, and a React-style in-place update.
    window.showReply = (text) => { document.getElementById('reply').textContent = text; };
    window.rewriteReply = (text) => { document.getElementById('reply').firstChild.nodeValue = text; };
    // Text dragged in from another app or tab.
    window.fireDrop = (id, text) => {
      const el = document.getElementById(id);
      const rect = el.getBoundingClientRect();
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new DragEvent('drop', {
        dataTransfer: data, bubbles: true, cancelable: true, composed: true,
        clientX: rect.left + 5, clientY: rect.top + 5,
      }));
    };
    window.firePaste = (id, text) => {
      const el = id === 'inner'
        ? document.getElementById('shadow-host').shadowRoot.getElementById('inner')
        : id === 'body' ? document.body : document.getElementById(id);
      el.focus();
      const data = new DataTransfer();
      data.setData('text/plain', text);
      // composed: true like a real user paste, so it crosses shadow boundaries.
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // Clipboard with only rich text (no text/plain), e.g. from some editors.
    window.firePasteHtml = (id, html) => {
      const el = document.getElementById(id);
      el.focus();
      const data = new DataTransfer();
      data.setData('text/html', html);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    };
  </script>
</body></html>`;

const SECRET_TEXT = 'Maria Gonzalez from Northwind Traders, maria@northwind.example, card 4111 1111 1111 1111';

let ollama;
let proxy;
let context;
let userDataDir;
let worker;

before(async () => {
  // rejectOrigin proves the declarativeNetRequest rule strips the header.
  ollama = await startMockOllama({ port: OLLAMA_PORT, host: '::', rejectOrigin: true });
  userDataDir = await mkdtemp(join(tmpdir(), 'anonymizer-e2e-'));
  // Every outbound request goes through a proxy that records and refuses it.
  // Fake AI pages are served by context.route before the network; the mock
  // Ollama is on localhost, which bypasses the proxy.
  proxy = await startRecordingProxy();
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    // Explicit bypass: Playwright otherwise forces loopback through the proxy.
    proxy: { server: proxy.url, bypass: 'localhost,127.0.0.1,[::1]' },
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  for (const site of ['https://chatgpt.com/**', 'https://claude.ai/**']) {
    await context.route(site, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_CHAT_PAGE }));
  }
});

after(async () => {
  await context?.close();
  await ollama?.close();
  await proxy?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function openChat(url = 'https://chatgpt.com/') {
  const page = await context.newPage();
  await page.goto(url);
  // Wait until the content script has asked the worker for its site status.
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(300);
  return page;
}

const assertClean = (value) => {
  for (const secret of ['Maria Gonzalez', 'Northwind Traders', 'maria@', '4111']) {
    assert.equal(value.includes(secret), false, `"${secret}" leaked into: ${value}`);
  }
  for (const type of ['PERSON', 'ORGANIZATION', 'EMAIL', 'CREDIT_CARD']) {
    assert.match(value, new RegExp(`\\[${type}_\\d+\\]`));
  }
};

const extensionUrl = (path) => `chrome-extension://${new URL(worker.url()).host}/${path}`;

async function sendFromExtensionPage(message) {
  const page = await context.newPage();
  await page.goto(extensionUrl('src/popup/popup.html'));
  const reply = await page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await page.close();
  return reply;
}

async function patchSettings(patch) {
  await worker.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...p } });
  }, patch);
}

// Closed shadow roots are invisible to page scripts but are rendered, so the
// accessibility tree is where the user-visible text can be checked.
async function visibleText(page) {
  const cdp = await context.newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  return nodes.map((n) => n.name?.value ?? '').join(' ');
}

const revealHosts = (page, selector) =>
  page.evaluate((sel) => document.querySelectorAll(`${sel} [data-anonymizer-reveal]`).length, selector);

test('paste into a textarea is anonymized', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('plain', t), SECRET_TEXT);
  await page.waitForFunction(() => document.getElementById('plain').value.includes('[PERSON_1]'), null, { timeout: 30000 });
  assertClean(await page.inputValue('#plain'));
  await page.close();
});

test('paste into a rich editor goes through its own paste handler, anonymized', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('rich', t), SECRET_TEXT);
  await page.waitForFunction(() => document.getElementById('rich').textContent.includes('[PERSON_1]'), null, { timeout: 30000 });
  assertClean(await page.textContent('#rich'));
  assert.equal(await page.evaluate(() => window.pageSawRawPaste), false, 'page saw the raw text');
  await page.close();
});

test('bare contenteditable falls back to insertText', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('bare', t), SECRET_TEXT);
  await page.waitForFunction(() => document.getElementById('bare').textContent.includes('[PERSON_1]'), null, { timeout: 30000 });
  assertClean(await page.textContent('#bare'));
  await page.close();
});

test('paste outside any text box is anonymized before a page-wide handler sees it', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('body', t), SECRET_TEXT);
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('plain').value), null, { timeout: 30000 });
  assertClean(await page.inputValue('#plain'));
  assert.equal(await page.evaluate(() => window.pageSawRawPaste), false, 'page-wide handler saw the raw text');
  await page.close();
});

test('text dropped into a text box is anonymized', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.fireDrop('plain', t), SECRET_TEXT);
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('plain').value), null, { timeout: 30000 });
  assertClean(await page.inputValue('#plain'));
  await page.evaluate((t) => window.fireDrop('bare', t), SECRET_TEXT);
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('bare').textContent), null, { timeout: 30000 });
  assertClean(await page.textContent('#bare'));
  await page.close();
});

// Same message the context menu and the Alt+Shift+A command send to the
// active tab.
async function runActionInTab(page, action, scope) {
  await page.bringToFront();
  await worker.evaluate(async ({ a, sc }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'runAction', action: a, scope: sc });
  }, { a: action, sc: scope });
}

test('Alt+Shift+A anonymizes the whole focused text box', async () => {
  const page = await openChat();
  await page.evaluate((t) => { const el = document.getElementById('plain'); el.value = t; el.focus(); el.setSelectionRange(0, 0); }, SECRET_TEXT);
  await runActionInTab(page, 'anonymize', 'field');
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('plain').value), null, { timeout: 30000 });
  assertClean(await page.inputValue('#plain'));
  await page.close();
});

test('right-click restore shows real values for the selected reply, outside the page DOM', async () => {
  const page = await openChat();
  const placeholder = await worker.evaluate(async () => {
    const { vault } = await chrome.storage.session.get('vault');
    return Object.entries(vault.byPlaceholder).find(([, v]) => v === 'Maria Gonzalez')[0];
  });
  await page.evaluate((p) => {
    window.showReply(`Please call ${p} tomorrow.`);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('reply'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, placeholder);
  await runActionInTab(page, 'restore', 'selection');
  await page.waitForTimeout(800);
  assert.match(await visibleText(page), /Please call Maria Gonzalez tomorrow\./);
  const pageReadable = await page.evaluate(() => document.body.innerText);
  assert.equal(pageReadable.includes('Maria Gonzalez'), false);
  await page.close();
});

test('a page faking dragstart cannot switch off drop protection', async () => {
  const page = await openChat();
  await page.evaluate(() => { document.getElementById('bare').textContent = ''; window.dispatchEvent(new Event('dragstart')); });
  await page.evaluate((t) => window.fireDrop('bare', t), SECRET_TEXT);
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('bare').textContent), null, { timeout: 30000 });
  assertClean(await page.textContent('#bare'));
  await page.close();
});

test('rich-text-only paste is converted to text and anonymized', async () => {
  const page = await openChat();
  await page.evaluate(() => window.firePasteHtml('bare', '<p><b>Maria Gonzalez</b> from Northwind Traders</p><p>maria@northwind.example, card 4111 1111 1111 1111</p>'));
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('bare').textContent), null, { timeout: 30000 });
  assertClean(await page.textContent('#bare'));
  await page.close();
});

// Editors such as TinyMCE put the text box in an about:blank or srcdoc
// frame. Those frames have no hostname of their own and belong to the page.
for (const kind of ['srcdoc', 'about:blank']) {
  test(`paste into a text box inside an ${kind} iframe is anonymized`, async () => {
    const page = await openChat();
    await page.evaluate((k) => new Promise((resolve) => {
      const frame = document.createElement('iframe');
      const body = '<textarea id="t"></textarea>';
      if (k === 'srcdoc') {
        frame.srcdoc = body;
        frame.onload = resolve;
        document.body.append(frame);
      } else {
        document.body.append(frame);
        frame.contentDocument.body.innerHTML = body;
        resolve();
      }
    }), kind);
    await page.waitForTimeout(500);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    await frame.evaluate((t) => {
      window.sawRaw = false;
      const area = document.getElementById('t');
      area.addEventListener('paste', (e) => { if (e.clipboardData.getData('text/plain').includes('Maria Gonzalez')) window.sawRaw = true; });
      area.focus();
      const data = new DataTransfer();
      data.setData('text/plain', t);
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    }, SECRET_TEXT);
    await frame.waitForFunction(() => document.getElementById('t').value.includes('[PERSON_'), null, { timeout: 30000 });
    assertClean(await frame.evaluate(() => document.getElementById('t').value));
    assert.equal(await frame.evaluate(() => window.sawRaw), false, 'the frame saw the raw text');
    await page.close();
  });
}

test('paste into a password field is left to the browser', async () => {
  const page = await openChat();
  const prevented = await page.evaluate(() => window.firePaste('pw', 'hunter2-secret-pass'));
  assert.equal(prevented, false, 'the extension must not swallow password pastes');
  await page.close();
});

const decoded = (entry) => Buffer.from(entry.b64, 'base64');

test('a text file picked with the file picker is cleaned before the site reads it', async () => {
  const page = await openChat();
  await page.setInputFiles('#upload', { name: 'Maria_Gonzalez_notes.txt', mimeType: 'text/plain', buffer: Buffer.from(SECRET_TEXT) });
  await page.waitForFunction(() => window.uploaded, null, { timeout: 30000 });
  const [received] = await page.evaluate(() => window.uploaded);
  assertClean(decoded(received).toString('utf8'));
  assert.match(received.name, /^\[PERSON_\d+\]_notes\.txt$/);
  assert.match(await visibleText(page), /Cleaned 1 file/);
  await page.close();
});

test('a real Word document is cleaned before the site reads it', async () => {
  const page = await openChat();
  await page.setInputFiles('#upload', fileURLToPath(new URL('../fixtures/python-docx.docx', import.meta.url)));
  await page.waitForFunction(() => window.uploaded, null, { timeout: 30000 });
  const [received] = await page.evaluate(() => window.uploaded);
  const parts = unzipSync(new Uint8Array(decoded(received)));
  const xml = Object.entries(parts).filter(([p]) => p.endsWith('.xml')).map(([, b]) => strFromU8(b)).join(' ');
  for (const value of ['Maria', 'Gonzalez', 'maria.gonzalez', '7946 0958', '4111 1111', 'Northwind Traders']) {
    assert.ok(!xml.includes(value), `${value} reached the site`);
  }
  await page.close();
});

test('a PDF is held: the site receives nothing until the user decides', async () => {
  const page = await openChat();
  await page.setInputFiles('#upload', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 Maria Gonzalez') });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.uploaded), undefined);
  assert.equal(await page.evaluate(() => document.getElementById('upload').files.length), 0, 'the input was emptied');
  assert.match(await visibleText(page), /can't be checked/);
  await page.close();
});

test('dropped and pasted files are cleaned before the site sees them', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.fireFile('drop', 'dropped.txt', t), SECRET_TEXT);
  await page.waitForFunction(() => window.dropped, null, { timeout: 30000 });
  assertClean(decoded((await page.evaluate(() => window.dropped))[0]).toString('utf8'));
  await page.evaluate((t) => window.fireFile('paste', 'pasted.csv', t), SECRET_TEXT);
  await page.waitForFunction(() => window.pastedFiles, null, { timeout: 30000 });
  assertClean(decoded((await page.evaluate(() => window.pastedFiles))[0]).toString('utf8'));
  await page.close();
});

async function downloadFrom(page) {
  await page.waitForSelector('.result a.button', { timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.result a.button')]);
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test('files page: clean a Word document, then restore the downloaded copy', async () => {
  const page = await context.newPage();
  await page.goto(extensionUrl('src/files/files.html#clean'));
  await page.setInputFiles('#file-input', fileURLToPath(new URL('../fixtures/python-docx.docx', import.meta.url)));
  const cleaned = await downloadFrom(page);
  const cleanedXml = strFromU8(unzipSync(cleaned.bytes)['word/document.xml']);
  assert.ok(!cleanedXml.includes('Maria') && !cleanedXml.includes('Northwind'), 'cleaned download still has names');
  assert.match(await page.textContent('.result'), /Cleaned.*name/s);

  await page.click('[data-mode="restore"]');
  await page.setInputFiles('#file-input', { name: cleaned.name, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(cleaned.bytes) });
  const restored = await downloadFrom(page);
  const text = extractOoxmlText(strFromU8(unzipSync(restored.bytes)['word/document.xml']), 'w:t', ['w:p']);
  assert.match(text, /Please call Maria Gonzalez at maria\.gonzalez@northwind\.example/);
  await page.close();
});

test('a file dropped straight onto a file-upload box is cleaned', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.fireFile('drop', 'onto-input.txt', t, 'upload'), SECRET_TEXT);
  await page.waitForFunction(() => window.dropped, null, { timeout: 30000 });
  assertClean(decoded((await page.evaluate(() => window.dropped))[0]).toString('utf8'));
  await page.close();
});

test('a "Copy image" paste (image plus empty HTML) is held, not passed through', async () => {
  const page = await openChat();
  await page.evaluate(() => window.fireFile('paste', 'image.png', 'PNG-bytes', 'bare', { mime: 'image/png', html: '<img src="https://example.org/a.png">' }));
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.pastedFiles), undefined);
  assert.match(await visibleText(page), /can't be checked/);
  await page.close();
});

test('built-in model is the default and loads from the bundled files', async () => {
  const reply = await sendFromExtensionPage({ type: 'modelStatus' });
  assert.equal(reply.data.state, 'ready');
  assert.equal(reply.data.source, 'bundled');
  assert.equal(ollama.requests.length, 0, 'Ollama should not be used by default');
});

test('worker restores placeholders from the session vault', async () => {
  const restored = await worker.evaluate(async () => {
    const { vault } = await chrome.storage.session.get('vault');
    return Object.values(vault.byPlaceholder);
  });
  assert.ok(restored.includes('Maria Gonzalez'));

  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await popup.click('[data-tab="restore"]');
  await popup.fill('#restore-input', 'Reply to [PERSON_1] at [EMAIL_1].');
  await popup.click('#restore-run');
  await popup.waitForFunction(() => document.getElementById('restore-output').value.length > 0);
  assert.equal(await popup.inputValue('#restore-output'), 'Reply to Maria Gonzalez at maria@northwind.example.');
  await popup.close();
});

test('paste into a textarea inside an open shadow root is anonymized', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('inner', t), SECRET_TEXT);
  const inner = () => document.getElementById('shadow-host').shadowRoot.getElementById('inner').value;
  await page.waitForFunction((fn) => new Function(`return (${fn})()`)().includes('[PERSON_1]'), inner.toString(), { timeout: 30000 });
  assertClean(await page.evaluate(inner));
  await page.close();
});

test('placeholder numbers are not reused after the vault is cleared', async () => {
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await popup.click('[data-tab="vault"]');
  await popup.click('#vault-clear');
  await popup.waitForSelector('.vault-empty');
  await popup.click('[data-tab="anonymize"]');
  await popup.fill('#anon-input', 'Ping Maria Gonzalez again');
  await popup.click('#anon-run');
  await popup.waitForSelector('#anon-result:not([hidden])');
  assert.equal(await popup.inputValue('#anon-output'), 'Ping [PERSON_2] again');
  await popup.close();
});

test('reply reveal: user sees real values, the page DOM keeps placeholders', async () => {
  const page = await openChat();
  await page.evaluate(() => { document.getElementById('rich').textContent = 'Draft about [PERSON_2]'; });
  const replyText = 'Sure, I will email [PERSON_2] now. Unknown: [PERSON_99].';
  await page.evaluate((t) => window.showReply(t), replyText);
  await page.waitForFunction(() => document.querySelectorAll('#reply [data-anonymizer-reveal]').length === 1, null, { timeout: 5000 });

  assert.equal(await page.textContent('#reply'), replyText, 'page DOM must still read placeholders');
  // Everything the page's own scripts can read (its <script> source aside).
  const pageReadable = await page.evaluate(() => [...document.body.childNodes]
    .filter((n) => n.nodeName !== 'SCRIPT')
    .map((n) => n.outerHTML ?? n.textContent).join('') + document.body.innerText);
  assert.equal(pageReadable.includes('Maria Gonzalez'), false, 'real name is readable by the page');
  const seen = await visibleText(page);
  assert.match(seen, /Maria Gonzalez/);
  assert.match(seen, /\[PERSON_99\]/, 'unknown placeholders stay visible');
  assert.equal(await revealHosts(page, '#rich'), 0, 'never reveal inside the composer');
  assert.equal(await page.textContent('#rich'), 'Draft about [PERSON_2]');

  // React-style in-place rewrite of the same text node: no leftovers.
  await page.evaluate(() => window.rewriteReply('Update: [PERSON_2] confirmed.'));
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('#reply'), 'Update: [PERSON_2] confirmed.');
  assert.equal(await revealHosts(page, '#reply'), 1);

  // Turning the setting off puts placeholders back on screen.
  await patchSettings({ restoreReplies: false });
  await page.waitForFunction(() => document.querySelectorAll('[data-anonymizer-reveal]').length === 0, null, { timeout: 5000 });
  assert.equal(await page.textContent('#reply'), 'Update: [PERSON_2] confirmed.');
  assert.doesNotMatch(await visibleText(page), /Maria Gonzalez/);
  await patchSettings({ restoreReplies: true });
  await page.close();
});

test('reply reveal is limited to the site the value was pasted on, and skips secrets', async () => {
  const chat = await openChat();
  await chat.evaluate((t) => window.firePaste('plain', t), SECRET_TEXT);
  await chat.waitForFunction(() => /\[CREDIT_CARD_\d+\]/.test(document.getElementById('plain').value), null, { timeout: 30000 });
  const sent = await chat.inputValue('#plain');
  await chat.close();

  // Fresh tab, so the paste confirmation panel (which lists originals) is not on screen.
  const reply = await openChat();
  await reply.evaluate((t) => window.showReply(t), sent);
  await reply.waitForFunction(() => document.querySelectorAll('#reply [data-anonymizer-reveal]').length >= 3, null, { timeout: 5000 });
  await reply.waitForTimeout(300);
  assert.equal(await revealHosts(reply, '#reply'), 3, 'person, organization and email; never the card');
  const onChat = await visibleText(reply);
  assert.match(onChat, /Northwind Traders/);
  assert.doesNotMatch(onChat, /4111/);
  await reply.close();

  // Same placeholders on another AI site: Northwind and the email were only
  // pasted on chatgpt.com, so claude.ai must not be able to probe for them.
  const other = await openChat('https://claude.ai/');
  await other.evaluate((t) => window.showReply(t), sent);
  await other.waitForTimeout(600);
  const onOther = await visibleText(other);
  assert.doesNotMatch(onOther, /Northwind Traders/);
  assert.doesNotMatch(onOther, /maria@northwind/);
  await other.close();
});

test('the panel, popup and Vault tab report what was protected, by type', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('plain', t), SECRET_TEXT);
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('plain').value), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  assert.match(await visibleText(page), /1 name, 1 organization, 1 email, 1 card number/);
  await page.close();

  const popup = await context.newPage();
  await popup.goto(extensionUrl('src/popup/popup.html'));
  await popup.fill('#anon-input', 'Ask Hannah Becker or Tom Ruiz, hannah@example.org');
  await popup.click('#anon-run');
  await popup.waitForSelector('#anon-result:not([hidden])');
  assert.match(await popup.textContent('#anon-note'), /^3 items replaced: 2 names, 1 email$/);

  await popup.click('[data-tab="vault"]');
  await popup.waitForSelector('#tally:not([hidden])');
  const tally = await popup.textContent('#tally');
  assert.match(tally, /items protected this session/);
  assert.match(tally, /\d+ names/);
  assert.match(tally, /By site: .*chatgpt\.com \d+/);
  assert.match(tally, /Popup \d+/);
  await popup.close();
});

test('Ollama engine: requests reach the local server without an Origin header', async () => {
  await patchSettings({ provider: 'ollama' });
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('plain', t), SECRET_TEXT);
  await page.waitForFunction(() => /\[PERSON_\d+\]/.test(document.getElementById('plain').value), null, { timeout: 30000 });
  assertClean(await page.inputValue('#plain'));
  const chats = ollama.requests.filter((r) => r.url === '/api/chat');
  assert.ok(chats.length > 0, 'model was never called');
  assert.ok(chats.every((r) => !r.headers.origin));
  await patchSettings({ provider: 'builtin' });
  await page.close();
});

test('pasting on a site the user paused leaves text untouched', async () => {
  await patchSettings({ disabledSites: ['chatgpt.com'] });
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('rich', t), SECRET_TEXT);
  await page.waitForTimeout(500);
  assert.equal(await page.textContent('#rich'), SECRET_TEXT);
  await page.close();
});

test('the extension makes no outbound network requests', () => {
  const unexpected = unexpectedHosts(proxy.hosts);
  assert.deepEqual(unexpected, [], `unexpected outbound hosts: ${unexpected.join(', ')}`);
});
