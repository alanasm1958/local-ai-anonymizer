// Message router. Every reply uses the envelope { ok, data?, error? }.

import { anonymize, restoreText } from '../core/anonymizer.js';
import { createModelClient } from '../core/llm.js';
import { isSiteEnabled, enabledTypes, normalizeHost } from '../core/settings.js';
import { vaultEntries, lookupForSite, isRevealable, ANY_SITE } from '../core/vault.js';
import {
  getSettings, saveSettings, getVault, setVault, clearVault, withVaultLock, keepAlive,
} from './state.js';
import { syncOriginRule, syncCustomSites, updateBadge, ensureContentScript } from './integrations.js';
import { builtinClient, builtinStatus, warmUpBuiltin, closeOffscreen } from './builtin.js';
import { BUILTIN_MODEL } from '../core/ner.js';

const MAX_TEXT_LENGTH = 200000;
const TEST_SAMPLE = 'Hi, I am Maria Gonzalez from Northwind Traders in Leeds. Please call me back about invoice 48213.';

const clientFor = (settings) => (settings.provider === 'builtin'
  ? builtinClient
  : createModelClient({
    provider: settings.provider,
    endpoint: settings.endpoint,
    model: settings.model,
    timeoutMs: settings.timeoutMs,
  }));

// One shape for the popup pill and the options page, whichever engine is on.
async function handleModelStatus() {
  const settings = await getSettings();
  if (!settings.useModel) return { state: 'off', label: 'Patterns only' };
  if (settings.provider === 'builtin') {
    const status = await builtinStatus();
    return { state: status.status, label: BUILTIN_MODEL.label, progress: status.progress, source: status.source, error: status.error };
  }
  try {
    const models = await clientFor(settings).listModels();
    const installed = models.some((m) => m === settings.model || m.split(':')[0] === settings.model);
    return { state: installed ? 'ready' : 'missing', label: settings.model, models };
  } catch (err) {
    return { state: 'error', label: settings.model, error: err.message };
  }
}

async function warmUpIfBuiltin(settings) {
  if (settings.useModel && settings.provider === 'builtin') await warmUpBuiltin();
}

function requireText(text) {
  if (typeof text !== 'string') throw new Error('Expected text to anonymize');
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`Text is too long (max ${MAX_TEXT_LENGTH.toLocaleString()} characters)`);
  return text;
}

const isExtensionPage = (sender) => sender.url?.startsWith(chrome.runtime.getURL(''));

// The host a content script runs on, or ANY_SITE for the extension's own pages.
function siteOf(sender) {
  if (isExtensionPage(sender)) return ANY_SITE;
  try {
    return normalizeHost(new URL(sender.url).hostname) || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function handleAnonymize({ text }, sender) {
  const input = requireText(text);
  const settings = await getSettings();
  const client = clientFor(settings);
  const site = siteOf(sender);
  return withVaultLock(() => keepAlive(async () => {
    const result = await anonymize(input, {
      settings, vault: await getVault(), detectEntities: client.detectEntities, site,
    });
    await setVault(result.vault);
    await updateBadge(result.vault);
    return { text: result.text, replacements: result.replacements, warnings: result.warnings };
  }));
}

async function handleRestore({ text }) {
  return restoreText(requireText(text), await getVault());
}

async function handleTestModel() {
  const settings = await getSettings();
  const started = Date.now();
  const entities = await keepAlive(() => clientFor(settings).detectEntities(TEST_SAMPLE, enabledTypes(settings.modelTypes)));
  return { sample: TEST_SAMPLE, entities, ms: Date.now() - started };
}

async function handleListModels() {
  return clientFor(await getSettings()).listModels();
}

async function handleSiteStatus({ hostname }) {
  const settings = await getSettings();
  return {
    active: isSiteEnabled(settings, hostname),
    interceptPaste: settings.interceptPaste,
    restoreReplies: settings.restoreReplies,
  };
}

const MAX_LOOKUP = 500;

// Placeholders in, originals out, for on-screen display in AI replies. Only
// values pasted on this same site (or added in the popup), and only types
// that are safe to draw in a page: see isRevealable.
async function handleLookup({ placeholders }, sender) {
  if (!Array.isArray(placeholders)) throw new Error('Expected a list of placeholders');
  const vault = await getVault();
  const site = siteOf(sender);
  return Object.fromEntries(
    placeholders
      .slice(0, MAX_LOOKUP)
      .filter((p) => typeof p === 'string' && isRevealable(p))
      .map((p) => [p, lookupForSite(vault, p, site)])
      .filter(([, original]) => original !== undefined),
  );
}

// Pages showing restored values put placeholders back.
async function broadcastVaultCleared() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'vaultCleared' }).catch(() => undefined)));
}

async function handleSaveSettings({ patch }) {
  const settings = await saveSettings(patch ?? {});
  await Promise.all([syncOriginRule(settings), syncCustomSites(settings)]);
  warmUpIfBuiltin(settings).catch((err) => console.error('[anonymizer] warm-up failed:', err));
  return settings;
}

async function handleClearVault() {
  await withVaultLock(clearVault);
  await updateBadge(await getVault());
  await broadcastVaultCleared();
  return true;
}

// Content scripts run inside AI pages, so they only get what paste
// protection needs. The vault and settings are for extension pages only.
const CONTENT_HANDLERS = Object.freeze({
  anonymize: handleAnonymize,
  restore: handleRestore,
  siteStatus: handleSiteStatus,
  lookup: handleLookup,
});

const PAGE_HANDLERS = Object.freeze({
  ...CONTENT_HANDLERS,
  testModel: handleTestModel,
  listModels: handleListModels,
  modelStatus: handleModelStatus,
  offscreenIdle: async () => closeOffscreen(),
  getSettings: () => getSettings(),
  saveSettings: handleSaveSettings,
  getVault: async () => vaultEntries(await getVault()),
  clearVault: handleClearVault,
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handlers = isExtensionPage(sender) ? PAGE_HANDLERS : CONTENT_HANDLERS;
  const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : null;
  if (!handler) return false;
  handler(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      console.error(`[anonymizer] ${message.type} failed:`, err);
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    });
  return true;
});

// Context menus and keyboard shortcut delegate to the content script, which
// knows the real selection (info.selectionText drops line breaks).
const MENU_ITEMS = Object.freeze([
  { id: 'anonymize-selection', title: 'Anonymize selection' },
  { id: 'restore-selection', title: 'Restore originals in selection' },
]);

async function sendToTab(tab, frameId, payload) {
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) return;
  try {
    await ensureContentScript(tab.id, frameId);
    await chrome.tabs.sendMessage(tab.id, payload, { frameId });
  } catch (err) {
    console.error('[anonymizer] could not reach page:', err);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action = info.menuItemId === 'restore-selection' ? 'restore' : 'anonymize';
  sendToTab(tab, info.frameId ?? 0, { type: 'runAction', action, scope: 'selection' });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'anonymize-field') sendToTab(tab, 0, { type: 'runAction', action: 'anonymize', scope: 'field' });
});

async function initialize() {
  const settings = await getSettings();
  await Promise.all([syncOriginRule(settings), syncCustomSites(settings), updateBadge(await getVault())]);
  // Load the model ahead of the first paste so it never waits on a cold start.
  await warmUpIfBuiltin(settings).catch((err) => console.error('[anonymizer] warm-up failed:', err));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    MENU_ITEMS.forEach((item) => chrome.contextMenus.create({ ...item, contexts: ['selection'] }));
  });
  initialize();
});

chrome.runtime.onStartup.addListener(initialize);
