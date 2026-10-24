import { call, $, h, withBusy } from '../ui/api.js';
import {
  PROVIDERS, PATTERN_TYPES, MODEL_TYPES, TYPE_LABELS, DEFAULT_SITES,
  isLocalEndpoint, normalizeHost,
} from '../core/settings.js';

let settings = null;
let savedTimer = null;

function flashSaved(text = 'Saved') {
  const badge = $('#saved');
  badge.textContent = text;
  badge.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => badge.classList.remove('show'), 1600);
}

async function save(patch) {
  settings = await call('saveSettings', { patch });
  flashSaved();
  return settings;
}

// ---------- model section ----------

function renderModelSection() {
  $('#provider').replaceChildren(...Object.entries(PROVIDERS).map(([value, { label }]) =>
    h('option', { value, selected: value === settings.provider }, label)));
  $('#endpoint').value = settings.endpoint;
  $('#model').value = settings.model;
  $('#timeout').value = String(Math.round(settings.timeoutMs / 1000));
  $('#useModel').checked = settings.useModel;
  document.querySelectorAll('input[name="onModelError"]').forEach((r) => { r.checked = r.value === settings.onModelError; });
  updateEndpointWarning();
}

function updateEndpointWarning() {
  $('#endpoint-warning').hidden = isLocalEndpoint($('#endpoint').value);
}

function onProviderChange() {
  const provider = $('#provider').value;
  const knownDefaults = Object.values(PROVIDERS).map((p) => p.endpoint);
  if (knownDefaults.includes($('#endpoint').value)) $('#endpoint').value = PROVIDERS[provider].endpoint;
  updateEndpointWarning();
}

// Endpoints outside the manifest's localhost permissions (LAN hosts, [::1],
// custom ports on https) need an optional host permission, requested from a
// click handler. Chrome resolves immediately without a prompt when the origin
// is already granted.
async function ensureEndpointPermission(endpoint) {
  const origin = `${new URL(endpoint).origin}/*`;
  return chrome.permissions.request({ origins: [origin] });
}

async function saveModelSettings() {
  const endpoint = $('#endpoint').value.trim();
  try {
    new URL(endpoint);
  } catch {
    flashSaved('Endpoint must be a full URL like http://localhost:11434');
    return false;
  }
  if (!(await ensureEndpointPermission(endpoint))) {
    flashSaved('Permission for that endpoint was not granted');
    return false;
  }
  const seconds = Number($('#timeout').value);
  await save({
    provider: $('#provider').value,
    endpoint,
    model: $('#model').value.trim(),
    timeoutMs: Number.isFinite(seconds) ? seconds * 1000 : settings.timeoutMs,
    onModelError: document.querySelector('input[name="onModelError"]:checked')?.value,
  });
  renderModelSection();
  return true;
}

async function refreshModels() {
  try {
    const models = await withBusy($('#refresh-models'), () => call('listModels'));
    $('#model-list').replaceChildren(...models.map((m) => h('option', { value: m })));
    flashSaved(models.length ? `${models.length} model${models.length === 1 ? '' : 's'} found` : 'No models installed');
  } catch (err) {
    showTestError(err);
  }
}

function showTestError(err) {
  const box = $('#test-result');
  box.hidden = false;
  box.replaceChildren(h('div', { class: 'notice error' }, err.message));
}

async function testModel() {
  if (!(await saveModelSettings())) return;
  const box = $('#test-result');
  try {
    const result = await withBusy($('#test-model'), () => call('testModel'));
    box.hidden = false;
    const found = result.entities.length
      ? result.entities.map((e) => h('span', { class: 'chip', title: e.type }, `${e.text} · ${e.type}`))
      : [h('span', { class: 'muted' }, 'Nothing detected. Try a larger model.')];
    box.replaceChildren(
      h('div', { class: 'row' }, h('strong', {}, 'Model responded'), h('span', { class: 'muted' }, `in ${(result.ms / 1000).toFixed(1)}s`)),
      h('div', { class: 'sample' }, result.sample),
      h('div', { class: 'found' }, found),
    );
  } catch (err) {
    showTestError(err);
  }
}

// ---------- types section ----------

function renderTypeChecks(container, types, key) {
  container.replaceChildren(...types.map((type) => {
    const input = h('input', {
      type: 'checkbox',
      checked: settings[key][type],
      onchange: (e) => save({ [key]: { ...settings[key], [type]: e.target.checked } }),
    });
    return h('label', {}, input, TYPE_LABELS[type], h('span', { class: 'chip' }, `[${type}_1]`));
  }));
}

// ---------- sites section ----------

function renderDefaultSites() {
  $('#default-sites').replaceChildren(...DEFAULT_SITES.map((site) => {
    const input = h('input', {
      type: 'checkbox',
      checked: !settings.disabledSites.includes(site),
      onchange: (e) => {
        const others = settings.disabledSites.filter((s) => s !== site);
        save({ disabledSites: e.target.checked ? others : [...others, site] });
      },
    });
    return h('label', {}, input, site);
  }));
}

function renderCustomSites() {
  $('#custom-sites').replaceChildren(...settings.customSites.map((site) =>
    h('div', { class: 'site-row' },
      h('span', {}, site),
      h('button', { class: 'danger', onclick: () => removeSite(site) }, 'Remove'))));
}

async function addSite(event) {
  event.preventDefault();
  const host = normalizeHost($('#new-site').value);
  if (!host) {
    flashSaved('Enter a site like ai.example.com');
    return;
  }
  if (DEFAULT_SITES.includes(host) || settings.customSites.includes(host)) {
    flashSaved('Already in the list');
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`https://${host}/*`, `https://*.${host}/*`] });
  if (!granted) {
    flashSaved('Permission was not granted');
    return;
  }
  await save({ customSites: [...settings.customSites, host] });
  $('#new-site').value = '';
  renderCustomSites();
}

async function removeSite(site) {
  await save({ customSites: settings.customSites.filter((s) => s !== site) });
  await chrome.permissions.remove({ origins: [`https://${site}/*`, `https://*.${site}/*`] });
  renderCustomSites();
}

// ---------- init ----------

async function init() {
  settings = await call('getSettings');
  renderModelSection();
  renderTypeChecks($('#pattern-types'), PATTERN_TYPES, 'patternTypes');
  renderTypeChecks($('#model-types'), MODEL_TYPES, 'modelTypes');
  $('#interceptPaste').checked = settings.interceptPaste;
  renderDefaultSites();
  renderCustomSites();

  $('#provider').addEventListener('change', onProviderChange);
  $('#endpoint').addEventListener('input', updateEndpointWarning);
  $('#useModel').addEventListener('change', (e) => save({ useModel: e.target.checked }));
  $('#interceptPaste').addEventListener('change', (e) => save({ interceptPaste: e.target.checked }));
  $('#save-model').addEventListener('click', saveModelSettings);
  $('#test-model').addEventListener('click', testModel);
  $('#refresh-models').addEventListener('click', refreshModels);
  $('#add-site').addEventListener('submit', addSite);
}

init().catch((err) => {
  document.querySelector('.page').prepend(h('p', { class: 'notice error' }, `Could not load settings: ${err.message}`));
});
