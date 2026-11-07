// Clean on send: text typed by hand is anonymized when the user presses
// Enter or clicks Send, before the site's own handlers read it. The fake
// page records every message it "sends" and what it saw at that moment.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, openPage, patchSettings } from '../helpers/extension-browser.js';
import { unexpectedHosts } from '../helpers/recording-proxy.js';

// Four composers, each sending the way a real AI site does:
// #enter-area   textarea, Enter sends (keydown, preventDefault), like ChatGPT
// #enter-rich   contenteditable, Enter sends, like Claude's ProseMirror box
// #button-area  textarea plus a "Send message" button (onClick)
// #form-input   input in a form, Enter submits the form
// #notes        textarea that does not send: Enter is just a newline
const PAGE = `<!doctype html><html><body>
  <textarea id="enter-area"></textarea>
  <div id="enter-rich" contenteditable="true" style="white-space:pre-wrap;min-height:30px"></div>
  <textarea id="button-area"></textarea><button id="send-btn" aria-label="Send message">&#x2191;</button>
  <form id="form"><input id="form-input" type="text"></form>
  <textarea id="notes"></textarea>
  <script>
    window.sent = [];
    const read = (el) => ('value' in el ? el.value : el.innerText);
    const record = (el, how, trusted) => {
      window.sent.push({ id: el.id, how, text: read(el), trusted });
      if ('value' in el) el.value = ''; else el.textContent = '';
    };
    for (const id of ['enter-area', 'enter-rich']) {
      document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        record(e.currentTarget, 'enter', e.isTrusted);
      });
    }
    document.getElementById('send-btn').addEventListener('click', (e) => record(document.getElementById('button-area'), 'button', e.isTrusted));
    document.getElementById('form').addEventListener('submit', (e) => {
      e.preventDefault();
      record(document.getElementById('form-input'), 'form', e.isTrusted);
    });
  </script>
</body></html>`;

const SECRET = 'my name is ali hassan and my phone number is 888999000';
const RAW = ['ali', 'hassan', '888999000'];
const WAIT = { timeout: 30000 };

let browser;

before(async () => {
  browser = await launchExtension({ page: PAGE });
});

after(async () => {
  await browser?.close();
});

const assertClean = (text) => {
  for (const raw of RAW) assert.ok(!new RegExp(`\\b${raw}\\b`).test(text), `"${raw}" was sent: ${text}`);
  assert.match(text, /\[PERSON_\d+\]/);
  assert.match(text, /\[PHONE_\d+\]/);
};

async function typeIn(page, selector, text) {
  await page.click(selector);
  await page.keyboard.type(text);
}

const sentMessages = (page) => page.evaluate(() => window.sent);
const waitForSend = (page, count = 1) => page.waitForFunction((n) => window.sent.length >= n, count, WAIT);

test('Enter in a textarea sends the anonymized text, never the typed one', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#enter-area', SECRET);
  await page.keyboard.press('Enter');
  await waitForSend(page);
  const [message] = await sentMessages(page);
  assertClean(message.text);
  assert.match(await page.evaluate(() => document.body.innerText), /./);
  await page.close();
});

test('Enter in a rich editor sends the anonymized text', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#enter-rich', SECRET);
  await page.keyboard.press('Enter');
  await waitForSend(page);
  assertClean((await sentMessages(page))[0].text);
  await page.close();
});

test('pressing Enter immediately after typing still sends nothing raw', async () => {
  const page = await openPage(browser.context);
  await page.click('#enter-area');
  await page.keyboard.type(SECRET, { delay: 0 });
  await page.keyboard.press('Enter');
  await waitForSend(page);
  const messages = await sentMessages(page);
  assert.equal(messages.length, 1, 'sent more than once');
  assertClean(messages[0].text);
  await page.close();
});

test('clicking a send button sends the anonymized text', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#button-area', SECRET);
  await page.click('#send-btn');
  await waitForSend(page);
  const messages = await sentMessages(page);
  assert.equal(messages.length, 1);
  assertClean(messages[0].text);
  await page.close();
});

test('Enter in a form field submits the anonymized text', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#form-input', SECRET);
  await page.keyboard.press('Enter');
  await waitForSend(page);
  assertClean((await sentMessages(page))[0].text);
  await page.close();
});

test('clean text that was already checked goes through as the real keystroke', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#enter-area', 'summarize the meeting notes please');
  await page.waitForTimeout(1500); // the background check runs after a pause
  await page.keyboard.press('Enter');
  await waitForSend(page);
  const [message] = await sentMessages(page);
  assert.equal(message.text, 'summarize the meeting notes please');
  assert.equal(message.trusted, true, 'the site should get the real Enter');
  await page.close();
});

test('Shift+Enter is a newline and is never held', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#enter-area', SECRET);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(500);
  assert.equal((await sentMessages(page)).length, 0);
  assert.equal(await page.inputValue('#enter-area'), `${SECRET}\n`);
  await page.close();
});

test('on a box that does not send, Enter cleans the text and still adds the newline', async () => {
  const page = await openPage(browser.context);
  await typeIn(page, '#notes', SECRET);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('notes').value.includes('[PERSON_'), null, WAIT);
  const value = await page.inputValue('#notes');
  assertClean(value);
  assert.ok(value.endsWith('\n'), 'the newline was lost');
  await page.close();
});

test('with "Check typed text" off, typed text is sent as typed', async () => {
  await patchSettings(browser.worker, { checkTyping: false });
  try {
    const page = await openPage(browser.context);
    await typeIn(page, '#enter-area', SECRET);
    await page.keyboard.press('Enter');
    await waitForSend(page);
    assert.equal((await sentMessages(page))[0].text, SECRET);
    await page.close();
  } finally {
    await patchSettings(browser.worker, { checkTyping: true });
  }
});

test('clean-on-send makes no outbound network requests', () => {
  const unexpected = unexpectedHosts(browser.proxy.hosts);
  assert.deepEqual(unexpected, [], `unexpected outbound hosts: ${unexpected.join(', ')}`);
});
