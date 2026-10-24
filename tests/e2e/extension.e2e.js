// End-to-end: loads the unpacked extension into Chromium, serves a fake
// chatgpt.com page (so the real content script injects), runs a mock Ollama
// on the default port and checks that pasted text arrives anonymized.

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
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_CHAT_PAGE }));
});

after(async () => {
  await context?.close();
  await ollama?.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function openChat() {
  const page = await context.newPage();
  await page.goto('https://chatgpt.com/');
  // Wait until the content script has asked the worker for its site status.
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(300);
  return page;
}

const assertClean = (value) => {
  for (const secret of ['Maria Gonzalez', 'Northwind Traders', 'maria@', '4111']) {
    assert.equal(value.includes(secret), false, `"${secret}" leaked into: ${value}`);
  }
  assert.match(value, /\[PERSON_1\]/);
  assert.match(value, /\[ORGANIZATION_1\]/);
  assert.match(value, /\[EMAIL_1\]/);
  assert.match(value, /\[CREDIT_CARD_1\]/);
};

test('paste into a textarea is anonymized', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('plain', t), SECRET_TEXT);
  await page.waitForFunction(() => document.getElementById('plain').value.includes('[PERSON_1]'), null, { timeout: 15000 });
  assertClean(await page.inputValue('#plain'));
  await page.close();
});

test('paste into a rich editor goes through its own paste handler, anonymized', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('rich', t), SECRET_TEXT);
  await page.waitForFunction(() => document.getElementById('rich').textContent.includes('[PERSON_1]'), null, { timeout: 15000 });
  assertClean(await page.textContent('#rich'));
  assert.equal(await page.evaluate(() => window.pageSawRawPaste), false, 'page saw the raw text');
  await page.close();
});

test('bare contenteditable falls back to insertText', async () => {
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('bare', t), SECRET_TEXT);
  await page.waitForFunction(() => document.getElementById('bare').textContent.includes('[PERSON_1]'), null, { timeout: 15000 });
  assertClean(await page.textContent('#bare'));
  await page.close();
});

test('requests to the local model carry no Origin header', () => {
  const chats = ollama.requests.filter((r) => r.url === '/api/chat');
  assert.ok(chats.length > 0, 'model was never called');
  assert.ok(chats.every((r) => !r.headers.origin));
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
  await page.waitForFunction((fn) => new Function(`return (${fn})()`)().includes('[PERSON_1]'), inner.toString(), { timeout: 15000 });
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

test('pasting on a site the user paused leaves text untouched', async () => {
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, disabledSites: ['chatgpt.com'] } });
  });
  const page = await openChat();
  await page.evaluate((t) => window.firePaste('rich', t), SECRET_TEXT);
  await page.waitForTimeout(500);
  assert.equal(await page.textContent('#rich'), SECRET_TEXT);
  await page.close();
});
