import { call, $, h, copyText, withBusy } from '../ui/api.js';
import { DEFAULT_SITES, isSiteEnabled, normalizeHost } from '../core/settings.js';
import { describeCount } from '../core/report.js';

let settings = null;

// ---------- header: master switch and model status ----------

const STATUS_POLL_MS = 1000;
const STATUS_POLL_LIMIT = 60;

function describeStatus(status) {
  const name = settings.provider === 'builtin' ? 'Built-in model' : status.label;
  switch (status.state) {
    case 'ready': return { tone: 'ok', text: name, title: `${status.label} is ready` };
    case 'off': return { tone: 'warn', text: 'Patterns only', title: 'Model detection is turned off in Settings' };
    case 'loading': return { tone: 'warn', text: status.progress < 100 ? `Loading ${status.progress}%` : 'Loading model', title: status.label };
    case 'missing': return { tone: 'warn', text: `${status.label} not installed`, title: `Installed: ${status.models?.join(', ') || 'none'}` };
    default: return { tone: 'bad', text: 'Model offline', title: status.error ?? 'Unknown error' };
  }
}

async function renderModelStatus(attempt = 0) {
  const pill = $('#model-status');
  let status;
  try {
    status = await call('modelStatus');
  } catch (err) {
    status = { state: 'error', error: err.message };
  }
  const { tone, text, title } = describeStatus(status);
  pill.className = `pill ${tone}`;
  pill.textContent = text;
  pill.title = title;
  if ((status.state === 'loading' || status.state === 'idle') && attempt < STATUS_POLL_LIMIT) {
    setTimeout(() => renderModelStatus(attempt + 1), STATUS_POLL_MS);
  }
}

async function onToggleEnabled(event) {
  settings = await call('saveSettings', { patch: { enabled: event.target.checked } });
  renderSite();
}

// ---------- current site row ----------

let currentHost = '';

async function loadCurrentHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url ?? '');
    currentHost = /^https?:$/.test(url.protocol) ? normalizeHost(url.hostname) : '';
  } catch {
    currentHost = '';
  }
}

const isKnownSite = (host) =>
  [...DEFAULT_SITES, ...settings.customSites].some((site) => host === site || host.endsWith(`.${site}`));

function renderSite() {
  const row = $('#site');
  row.replaceChildren();
  if (!currentHost) return;
  if (!isKnownSite(currentHost)) {
    row.append(
      h('span', { class: 'muted' }, 'Paste protection is off on '),
      h('span', { class: 'host' }, currentHost),
      h('span', { class: 'spacer' }),
      h('a', { href: '#', onclick: openOptions }, 'Add site'),
    );
    return;
  }
  const active = isSiteEnabled(settings, currentHost);
  const input = h('input', { type: 'checkbox', checked: active, disabled: !settings.enabled, onchange: onToggleSite });
  row.append(
    h('span', { class: active ? '' : 'muted' }, active ? 'Protecting pastes on ' : 'Paused on '),
    h('span', { class: 'host' }, currentHost),
    h('span', { class: 'spacer' }),
    h('label', { class: 'switch', title: 'Protect this site' }, input, h('span', { class: 'track' })),
  );
}

async function onToggleSite(event) {
  const others = settings.disabledSites.filter((s) => s !== currentHost);
  const disabledSites = event.target.checked ? others : [...others, currentHost];
  settings = await call('saveSettings', { patch: { disabledSites } });
  renderSite();
}

// ---------- tabs ----------

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  if (name === 'vault') renderVault();
}

// ---------- anonymize ----------

function renderChips(replacements) {
  const unique = [...new Map(replacements.map((r) => [r.placeholder, r])).values()];
  $('#anon-chips').replaceChildren(...unique.map((r) => h('span', { class: 'chip', title: r.original }, r.placeholder)));
}

async function runAnonymize() {
  const text = $('#anon-input').value;
  const note = $('#anon-note');
  if (!text.trim()) return;
  note.textContent = 'Running locally...';
  try {
    const result = await withBusy($('#anon-run'), () => call('anonymize', { text }));
    $('#anon-output').value = result.text;
    $('#anon-result').hidden = false;
    renderChips(result.replacements);
    const { items, breakdown } = result.summary;
    const replaced = items ? `${items} item${items === 1 ? '' : 's'} replaced: ${breakdown}` : 'Nothing sensitive found';
    note.textContent = result.warnings[0] ?? replaced;
    note.className = result.warnings.length ? 'small warn-text' : 'muted small';
    refreshVaultCount();
  } catch (err) {
    note.textContent = err.message;
    note.className = 'small error-text';
  }
}

// ---------- restore ----------

async function runRestore() {
  const text = $('#restore-input').value;
  if (!text.trim()) return;
  try {
    const result = await withBusy($('#restore-run'), () => call('restore', { text }));
    $('#restore-output').value = result.text;
    $('#restore-result').hidden = false;
    const unknown = result.unknownCount
      ? `. ${result.unknownCount} not in the vault (cleared or from another session)`
      : '';
    $('#restore-note').textContent = `${result.restoredCount} placeholder${result.restoredCount === 1 ? '' : 's'} restored${unknown}`;
  } catch (err) {
    $('#restore-note').textContent = err.message;
  }
}

// ---------- vault ----------

async function refreshVaultCount() {
  const entries = await call('getVault');
  $('#vault-count').textContent = entries.length ? String(entries.length) : '';
  return entries;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Session summary: what was protected, by type and by site.
async function renderTally() {
  const box = $('#tally');
  const tally = await call('getTally');
  box.hidden = tally.items === 0;
  if (tally.items === 0) return;
  const mentions = tally.mentions > tally.items ? `, ${plural(tally.mentions, 'mention')}` : '';
  box.replaceChildren(
    h('div', { class: 'tally-head' }, `${plural(tally.items, 'item')} protected this session `,
      h('span', {}, `(${plural(tally.runs, 'run')}${mentions})`)),
    h('div', { class: 'tally-types' }, tally.byType.map((t) => h('span', {}, describeCount(t)))),
    tally.bySite.length
      ? h('div', { class: 'tally-sites' }, 'By site: ', tally.bySite.flatMap((s, i) => [
        i ? ' · ' : '', h('strong', {}, s.site), ` ${s.items}`,
      ]))
      : null,
  );
}

async function renderVault() {
  renderTally();
  const entries = await refreshVaultCount();
  const list = $('#vault-list');
  if (!entries.length) {
    list.replaceChildren(h('div', { class: 'vault-empty' }, 'Nothing stored yet'));
    return;
  }
  list.replaceChildren(...entries.map(({ placeholder, original }) =>
    h('div', { class: 'vault-row' }, h('span', { class: 'chip' }, placeholder), h('span', { class: 'orig', title: original }, original))));
}

async function clearVault() {
  await call('clearVault');
  renderVault();
}

function openOptions(event) {
  event?.preventDefault();
  chrome.runtime.openOptionsPage();
}

// ---------- init ----------

async function init() {
  settings = await call('getSettings');
  $('#enabled').checked = settings.enabled;
  $('#restoreReplies').checked = settings.restoreReplies;
  await loadCurrentHost();
  renderSite();
  renderModelStatus();
  refreshVaultCount();

  $('#enabled').addEventListener('change', onToggleEnabled);
  $('#restoreReplies').addEventListener('change', async (e) => {
    settings = await call('saveSettings', { patch: { restoreReplies: e.target.checked } });
  });
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
  $('#anon-run').addEventListener('click', runAnonymize);
  $('#restore-run').addEventListener('click', runRestore);
  $('#anon-copy').addEventListener('click', (e) => copyText(e.target, $('#anon-output').value));
  $('#restore-copy').addEventListener('click', (e) => copyText(e.target, $('#restore-output').value));
  $('#vault-clear').addEventListener('click', clearVault);
  $('#open-options').addEventListener('click', openOptions);
  // A popup closes when a file picker opens, so files get their own page.
  document.querySelectorAll('.file-link').forEach((link) => link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL(`src/files/files.html#${link.dataset.files}`) });
  }));
  $('#anon-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runAnonymize();
  });
}

init().catch((err) => {
  document.querySelector('main').prepend(h('p', { class: 'notice error' }, `Could not load: ${err.message}`));
});
