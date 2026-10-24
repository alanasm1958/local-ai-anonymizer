// End-to-end: loads the unpacked extension into Chromium (with the bundled
// built-in model from vendor/), serves a fake chatgpt.com page so the real
// content scripts inject, and checks pastes, reply reveal and the Ollama path
// (against a mock on the default port). Run `npm run vendor` first.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startMockOllama } from '../helpers/mock-ollama.js';

const EXTENSION_PATH = fileURLToPath(new URL('../../', import.meta.url));
const OLLAMA_PORT = 11434;

// A textarea, a ProseMirror-like editor that handles paste itself, and a
// bare contenteditable that relies on the execCommand fallback.
const FAKE_CHAT_PAGE = `<!doctype html><html><body>
  <textarea id="plain" rows="6" cols="80"></textarea>
  <div id="rich" contenteditable="true" style="min-height:60px;border:1px solid #ccc"></div>
  <div id="bare" contenteditable="true" style="min-height:60px;border:1px solid #ccc"></div>
  <chat-box id="shadow-host"></chat-box>
  <div id="reply"></div>
  <script>
    customElements.define('chat-box', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<textarea id="inner"></textarea>'; }
    });
    window.pageSawRawPaste = false;
    document.getElementById('rich').addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (text.includes('Maria Gonzalez')) window.pageSawRawPaste = true;
      e.currentTarget.textContent += text;
    });
    // A chat reply rendered by the page, and a React-style in-place update.
    window.showReply = (text) => { document.getElementById('reply').textContent = text; };
    window.rewriteReply = (text) => { document.getElementById('reply').firstChild.nodeValue = text; };
    window.firePaste = (id, text) => {
      const el = id === 'inner'
        ? document.getElementById('shadow-host').shadowRoot.getElementById('inner')
        : document.getElementById(id);
      el.focus();
      const data = new DataTransfer();
      data.setData('text/plain', text);
      // composed: true like a real user paste, so it crosses shadow boundaries.
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    };
  </script>
</body></html>`;

const SECRET_TEXT = 'Maria Gonzalez from Northwind Traders, maria@northwind.example, card 4111 1111 1111 1111';

let ollama;
let context;
let userDataDir;
let worker;

before(async () => {
  // rejectOrigin proves the declarativeNetRequest rule strips the header.
  ollama = await startMockOllama({ port: OLLAMA_PORT, host: '::', rejectOrigin: true });
  userDataDir = await mkdtemp(join(tmpdir(), 'anonymizer-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
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
