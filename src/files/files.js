// Clean or restore files by hand. Opened from the popup (a popup closes when
// a file picker opens, so this is a full page). Same engine as uploads.

import { call, $, h } from '../ui/api.js';
import { bytesToBase64, base64ToBytes } from '../core/base64.js';
import { MAX_FILE_BYTES } from '../core/files.js';

const MODES = Object.freeze({
  clean: {
    message: 'anonymizeFile',
    help: 'Supported: text and code files, CSV, JSON, Word (.docx), Excel (.xlsx) and PowerPoint (.pptx). PDFs and images can\'t be checked. Author names are removed from Office files.',
    drop: 'Drop files to clean',
  },
  restore: {
    message: 'restoreFile',
    help: 'Puts the real values back into a file an AI produced, using the placeholders from this browser session. After the browser restarts, earlier placeholders can no longer be restored.',
    drop: 'Drop files to restore',
  },
});

const STATUS = Object.freeze({
  cleaned: 'Cleaned',
  restored: 'Restored',
  unchanged: 'Nothing to change',
  unsupported: 'Can\'t be checked',
});

let mode = location.hash === '#restore' ? 'restore' : 'clean';

function setMode(next) {
  mode = next;
  history.replaceState(null, '', `#${next}`);
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === next)));
  $('#mode-help').textContent = MODES[next].help;
  $('#drop-title').textContent = MODES[next].drop;
  $('#results').replaceChildren();
}

function downloadLink(reply) {
  const blob = new Blob([base64ToBytes(reply.data)], { type: reply.mime || 'application/octet-stream' });
  return h('a', { class: 'button', href: URL.createObjectURL(blob), download: reply.name }, 'Download');
}

function renderResult(card, file, reply) {
  const renamed = reply.name !== file.name ? h('span', { class: 'rename' }, ` → ${reply.name}`) : null;
  const lines = [
    h('span', {}, STATUS[reply.status] ?? reply.status),
    reply.summary?.breakdown ? h('span', {}, reply.summary.breakdown) : null,
    reply.reason ? h('span', { class: 'warn' }, reply.reason) : null,
    // Only gaps are highlighted; "author names were removed" is good news.
    ...reply.notes.map((n) => h('span', { class: /not checked|unavailable|only patterns|may remain/i.test(n) ? 'warn' : '' }, n)),
  ];
  card.replaceChildren(
    h('div', { class: 'name' }, file.name, renamed),
    reply.data ? downloadLink(reply) : h('span', {}),
    h('div', { class: 'detail' }, lines),
  );
}

async function processFile(file) {
  const card = h('div', { class: 'result' }, h('div', { class: 'name' }, file.name), h('span', { class: 'muted' }, 'Working...'));
  $('#results').prepend(card);
  if (file.size > MAX_FILE_BYTES) {
    renderResult(card, file, { status: 'unsupported', name: file.name, notes: [], reason: 'The file is larger than 25 MB.' });
    return;
  }
  try {
    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const reply = await call(MODES[mode].message, { name: file.name, mime: file.type, data });
    renderResult(card, file, reply);
  } catch (err) {
    renderResult(card, file, { status: 'unsupported', name: file.name, notes: [], reason: err.message });
  }
}

async function processAll(files) {
  for (const file of files) await processFile(file);
}

function init() {
  setMode(mode);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  $('#file-input').addEventListener('change', (e) => {
    processAll([...e.target.files]);
    e.target.value = '';
  });
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    processAll([...e.dataTransfer.files]);
  });
}

init();
