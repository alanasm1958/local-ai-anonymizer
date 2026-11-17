// Scenario package, browser half: every case in tests/scenarios/cases.js is
// delivered through its channel (paste, drop, typing, shortcut, selection,
// file picker, reply reveal) to the real extension with the bundled model.
// Documented gaps run as todo tests. Set SCENARIO_REPORT=<file> for a JSON
// report. The text half (pipeline only) is `npm run scenarios`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { unexpectedHosts } from '../helpers/recording-proxy.js';
import { launchExtension, openPage } from '../helpers/extension-browser.js';
import { CASES } from '../scenarios/cases.js';
import { judge } from '../scenarios/check.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const WAIT = { timeout: 30000 };

const PAGE = `<!doctype html><html><head><style>[contenteditable]{white-space:pre-wrap;min-height:40px}</style></head><body>
  <textarea id="plain" rows="6" cols="80"></textarea>
  <div id="rich" contenteditable="true"></div>
  <div id="bare" contenteditable="true"></div>
  <chat-box id="shadow-host"></chat-box>
  <div id="reply"></div>
  <input id="upload" type="file" multiple>
  <script>
    customElements.define('chat-box', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<textarea id="inner"></textarea>'; }
    });
    document.addEventListener('paste', (e) => {
      if (e.defaultPrevented || e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      document.getElementById('plain').value += e.clipboardData.getData('text/plain');
    });
    document.getElementById('rich').addEventListener('paste', (e) => {
      e.preventDefault();
      e.currentTarget.textContent += e.clipboardData.getData('text/plain');
    });
    const readFiles = (files) => Promise.all([...files].map(async (f) => ({
      name: f.name, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))),
    })));
    document.getElementById('upload').addEventListener('change', async (e) => { window.uploaded = await readFiles(e.target.files); });
    const target = (id) => id === 'inner'
      ? document.getElementById('shadow-host').shadowRoot.getElementById('inner')
      : id === 'body' ? document.body : document.getElementById(id);
    window.readTarget = (id) => {
      const el = target(id);
      return 'value' in el ? el.value : el.innerText;
    };
    window.fireClipboard = (id, type, payload) => {
      const el = target(id);
      el.focus();
      const data = new DataTransfer();
      data.setData(type, payload);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    };
    window.fireDrop = (id, text) => {
      const el = target(id);
      const rect = el.getBoundingClientRect();
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, composed: true, clientX: rect.left + 5, clientY: rect.top + 5 }));
    };
  </script>
</body></html>`;

let browser;
let context;
let worker;
const report = [];

before(async () => {
  browser = await launchExtension({ page: PAGE });
  ({ context, worker } = browser);
});

after(async () => {
  if (process.env.SCENARIO_REPORT) await writeFile(process.env.SCENARIO_REPORT, JSON.stringify(report, null, 2));
  await browser?.close();
});

const openChat = () => openPage(context);

// Same message the context menu and the Alt+Shift+A command send.
async function runActionInTab(page, scope) {
  await page.bringToFront();
  await worker.evaluate(async (sc) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'runAction', action: 'anonymize', scope: sc });
  }, scope);
}

// Waits for the text box to fill, then for it to stop changing.
async function settledText(page, id) {
  await page.waitForFunction((i) => window.readTarget(i).length > 0, id, WAIT);
  let last = null;
  for (;;) {
    const now = await page.evaluate((i) => window.readTarget(i), id);
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(400);
  }
}

async function changedText(page, id, before) {
  await page.waitForFunction(([i, b]) => window.readTarget(i) !== b, [id, before], WAIT);
  return settledText(page, id);
}

async function typeInto(page, text) {
  await page.click('#plain');
  // keyboard.type sends real key events; newlines become Enter presses.
  await page.keyboard.type(text);
  return page.inputValue('#plain');
}

const decoded = (entry) => Buffer.from(entry.b64, 'base64');

function officeText(bytes) {
  const parts = unzipSync(new Uint8Array(bytes));
  return Object.entries(parts).filter(([p]) => /\.(xml|rels)$/.test(p)).map(([, b]) => strFromU8(b)).join('\n');
}

// Visible to the user (closed shadow roots render), not to page scripts.
async function visibleText(page) {
  const cdp = await context.newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  return nodes.map((n) => n.name?.value ?? '').join(' ');
}

const PASTE_TARGET = { 'paste-textarea': 'plain', 'paste-rich': 'rich', 'paste-bare': 'bare', 'paste-shadow': 'inner' };

// Each returns { output, extra }: output is judged; extra holds channel checks.
const DELIVER = {
  async paste(page, kase) {
    const id = PASTE_TARGET[kase.channel];
    await page.evaluate(([i, t]) => window.fireClipboard(i, 'text/plain', t), [id, kase.text]);
    return { output: await settledText(page, id) };
  },
  async 'paste-page'(page, kase) {
    await page.evaluate((t) => window.fireClipboard('body', 'text/plain', t), kase.text);
    return { output: await settledText(page, 'plain') };
  },
  async 'paste-html'(page, kase) {
    await page.evaluate((h) => window.fireClipboard('plain', 'text/html', h), kase.html);
    return { output: await settledText(page, 'plain') };
  },
  async drop(page, kase) {
    await page.evaluate((t) => window.fireDrop('plain', t), kase.text);
    return { output: await settledText(page, 'plain') };
  },
  // This page does not send on Enter, so the cleaned text stays in the box
  // with the newline the key would have typed.
  async 'type-enter'(page, kase) {
    const typed = await typeInto(page, kase.text);
    await page.keyboard.press('Enter');
    return { output: await changedText(page, 'plain', typed) };
  },
  async 'type-shortcut'(page, kase) {
    const typed = await typeInto(page, kase.text);
    await runActionInTab(page, 'field');
    return { output: await changedText(page, 'plain', typed) };
  },
  async selection(page, kase) {
    const typed = await typeInto(page, kase.text);
    const start = kase.text.indexOf(kase.select);
    await page.evaluate(([s, e]) => document.getElementById('plain').setSelectionRange(s, e), [start, start + kase.select.length]);
    await runActionInTab(page, 'selection');
    return { output: await changedText(page, 'plain', typed) };
  },
  async upload(page, kase) {
    await page.setInputFiles('#upload', kase.files.map((f) => ({ name: f.name, mimeType: f.mime, buffer: Buffer.from(f.body) })));
    await page.waitForFunction(() => window.uploaded, null, WAIT);
    const received = await page.evaluate(() => window.uploaded);
    return {
      output: received.map((r) => `${r.name}\n${decoded(r).toString('utf8')}`).join('\n\n'),
      extra: { fileCount: received.length },
    };
  },
  async 'upload-office'(page, kase) {
    await page.setInputFiles('#upload', kase.fixtures.map((f) => fileURLToPath(new URL(f, FIXTURES))));
    await page.waitForFunction(() => window.uploaded, null, WAIT);
    const received = await page.evaluate(() => window.uploaded);
    return {
      output: received.map((r) => `${r.name}\n${officeText(decoded(r))}`).join('\n\n'),
      extra: { fileCount: received.length },
    };
  },
  async held(page, kase) {
    await page.setInputFiles('#upload', kase.files.map((f) => ({ name: f.name, mimeType: f.mime, buffer: Buffer.from(f.body) })));
    await page.waitForTimeout(2000);
    const extra = {
      siteReceived: await page.evaluate(() => window.uploaded ?? null),
      inputFiles: await page.evaluate(() => document.getElementById('upload').files.length),
      panel: (await visibleText(page)).includes("can't be checked"),
    };
    return { output: '', extra };
  },
  async reveal(page, kase) {
    await page.evaluate((t) => window.fireClipboard('plain', 'text/plain', t), kase.text);
    const pasted = await settledText(page, 'plain');
    // The success panel also lists real values, so count mentions before and
    // after the reply: only the reveal can add new ones.
    const mentions = (text, v) => text.split(v).length - 1;
    const beforeReply = await visibleText(page);
    await page.evaluate((t) => { document.getElementById('reply').textContent = `Sure! Here is a draft for ${t}`; }, pasted);
    await page.waitForFunction(() => document.querySelectorAll('#reply [data-anonymizer-reveal]').length > 0, null, WAIT);
    const seen = await visibleText(page);
    const domText = await page.textContent('#reply');
    const userSees = (kase.remove ?? []).filter((v) => mentions(seen, v) > mentions(beforeReply, v));
    return { output: domText, extra: { pasted, userSees } };
  },
};

const deliverFor = (channel) => (PASTE_TARGET[channel] ? DELIVER.paste : DELIVER[channel]);

// Channel checks that go beyond "removed / kept".
function channelProblems(kase, extra = {}) {
  const problems = [];
  if (kase.channel === 'held') {
    if (extra.siteReceived) problems.push('site received a file that cannot be checked');
    if (extra.inputFiles !== 0) problems.push('file input was not emptied');
    if (!extra.panel) problems.push('no "can\'t be checked" notice shown');
  }
  if (kase.channel === 'reveal' && extra.userSees.length !== kase.remove.length) {
    problems.push(`user does not see real values: missing ${kase.remove.filter((v) => !extra.userSees.includes(v)).join(', ')}`);
  }
  if ((kase.channel === 'upload' || kase.channel === 'upload-office') && extra.fileCount !== (kase.files ?? kase.fixtures).length) {
    problems.push(`site received ${extra.fileCount} of ${(kase.files ?? kase.fixtures).length} files`);
  }
  return problems;
}

for (const kase of CASES) {
  test(`${kase.id} [${kase.channel}] ${kase.title}`, { todo: kase.known }, async () => {
    const page = await openChat();
    const started = Date.now();
    let entry;
    try {
      const { output, extra } = await deliverFor(kase.channel)(page, kase);
      const verdict = judge(output, kase);
      const problems = channelProblems(kase, extra);
      const status = verdict.status === 'pass' && problems.length ? 'fail' : verdict.status;
      entry = { id: kase.id, channel: kase.channel, title: kase.title, ...verdict, status, problems, output, extra, ms: Date.now() - started };
    } catch (err) {
      entry = { id: kase.id, channel: kase.channel, title: kase.title, status: 'error', error: err.message, ms: Date.now() - started };
    } finally {
      await page.close();
    }
    report.push(entry);
    assert.notEqual(entry.status, 'error', `${kase.id} could not run: ${entry.error}`);
    assert.ok(['pass', 'fixed'].includes(entry.status) || (entry.status === 'known' && kase.known),
      `${kase.id}: leaked [${entry.leaked.join(' | ')}] over-redacted [${entry.overRedacted.join(' | ')}] ${[...entry.notes, ...entry.problems].join('; ')}\n  output: ${JSON.stringify(entry.output)}`);
  });
}

test('no scenario made an outbound network request', () => {
  const unexpected = unexpectedHosts(browser.proxy.hosts);
  assert.deepEqual(unexpected, [], `unexpected outbound hosts: ${unexpected.join(', ')}`);
});
