// Message router. Every reply uses the envelope { ok, data?, error? }.

import { anonymize, restoreText, placeholderSpans } from '../core/anonymizer.js';
import { createModelClient } from '../core/llm.js';
import { isSiteEnabled, enabledTypes, normalizeHost } from '../core/settings.js';
import { vaultEntries, lookupForSite, isRevealable, originalsForCopy, ANY_SITE } from '../core/vault.js';
import {
  getSettings, saveSettings, getVault, setVault, clearVault, withVaultLock, keepAlive, getStats, setStats,
} from './state.js';
import { summarizeReplacements, formatBreakdown, recordRun, sessionTally } from '../core/report.js';
import { anonymizeFile, restoreFile, MAX_FILE_BYTES } from '../core/files.js';
import { bytesToBase64, base64ToBytes } from '../core/base64.js';
import * as fflate from '../../vendor/fflate/fflate.js';
import { syncOriginRule, syncCustomSites, updateBadge, ensureContentScript } from './integrations.js';
import { builtinClient, builtinStatus, warmUpBuiltin, closeOffscreen } from './builtin.js';
import { BUILTIN_MODEL } from '../core/ner.js';
import { shouldShowGuide, GUIDE_PATH } from '../core/welcome.js';

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

const hostOf = (url) => {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
};

// The host a content script runs on, or ANY_SITE for the extension's own pages.
// about:blank and srcdoc frames have no host in their URL: their origin, or
// failing that the tab's page, says which site they belong to.
function siteOf(sender) {
  if (isExtensionPage(sender)) return ANY_SITE;
  return hostOf(sender.url) || hostOf(sender.origin) || hostOf(sender.tab?.url) || 'unknown';
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
    const summary = summarizeReplacements(result.replacements);
    await setStats(recordRun(await getStats(), summary));
    return {
      text: result.text,
      replacements: result.replacements,
      warnings: result.warnings,
      summary: { ...summary, breakdown: formatBreakdown(summary.byType) },
    };
  }));
}

// Read-only check of typed text: the same detection, but nothing is saved
// (no placeholders, no stats), so half-typed words never reach the vault.
async function handleScan({ text }, sender) {
  const input = requireText(text);
  const settings = await getSettings();
  const result = await keepAlive(async () => anonymize(input, {
    settings, vault: await getVault(), detectEntities: clientFor(settings).detectEntities, site: siteOf(sender),
  }));
  return { found: result.replacements.length, warnings: result.warnings.length };
}

// ---------- files ----------

// The MIME type travels as `mime`: `type` is the message's handler name.
function requireFile({ name, mime, data }) {
  if (typeof name !== 'string' || typeof data !== 'string') throw new Error('Expected a file');
  if (data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) throw new Error('The file is too large to check');
  return { name, type: typeof mime === 'string' ? mime : '', bytes: base64ToBytes(data) };
}

const fileReply = (result, summary, warnings = []) => ({
  status: result.status,
  reason: result.reason ?? null,
  name: result.name,
  mime: result.type,
  // Bytes travel back only when they changed.
  data: result.status === 'cleaned' || result.status === 'restored' ? bytesToBase64(result.bytes) : null,
  // Model problems first: a file checked by rules only must say so.
  notes: [...warnings, ...result.notes],
  summary: summary ? { ...summary, breakdown: formatBreakdown(summary.byType) } : null,
});

// One vault lock for the whole file, so every part of a document shares
// placeholders and nothing else interleaves.
async function handleAnonymizeFile(message, sender) {
  const file = requireFile(message);
  const settings = await getSettings();
  const client = clientFor(settings);
  const site = siteOf(sender);
  return withVaultLock(() => keepAlive(async () => {
    let vault = await getVault();
    const warnings = new Set();
    const anonymizeText = async (text) => {
      const result = await anonymize(text, { settings, vault, detectEntities: client.detectEntities, site });
      vault = result.vault;
      result.warnings.forEach((w) => warnings.add(w));
      return result;
    };
    const result = await anonymizeFile(file, { anonymizeText, zip: fflate });
    await setVault(vault);
    await updateBadge(vault);
    const summary = summarizeReplacements(result.replacements);
    await setStats(recordRun(await getStats(), summary));
    return fileReply(result, summary, [...warnings]);
  }));
}

async function handleRestoreFile(message) {
  const file = requireFile(message);
  const vault = await getVault();
  const result = await restoreFile(file, { restoreSpans: (text) => placeholderSpans(text, vault), zip: fflate });
  return fileReply(result, null);
}

// Vault tab: what this session has protected, by type and by site.
async function handleGetTally() {
  const tally = sessionTally(await getVault(), await getStats());
  return { ...tally, breakdown: formatBreakdown(tally.byType) };
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
    checkTyping: settings.checkTyping,
    restoreReplies: settings.restoreReplies,
    restoreOnCopy: settings.restoreOnCopy,
    checkFiles: settings.checkFiles,
    holdUncheckedFiles: settings.holdUncheckedFiles,
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

// Placeholders in a copied reply, originals out, for the user's clipboard
// (copy-restore.js). Every type, but only values pasted on this site.
async function handleCopyOriginals({ placeholders }, sender) {
  return originalsForCopy(await getVault(), placeholders, siteOf(sender));
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
  scan: handleScan,
  restore: handleRestore,
  siteStatus: handleSiteStatus,
  lookup: handleLookup,
  copyOriginals: handleCopyOriginals,
  anonymizeFile: handleAnonymizeFile,
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
  getTally: handleGetTally,
  restoreFile: handleRestoreFile,
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

async function openGuideOnFirstInstall(reason) {
  try {
    const { installType } = await chrome.management.getSelf();
    if (shouldShowGuide(reason, installType)) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(GUIDE_PATH) });
    }
  } catch (err) {
    console.warn('Could not open the How to use guide:', err);
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    MENU_ITEMS.forEach((item) => chrome.contextMenus.create({ ...item, contexts: ['selection'] }));
  });
  initialize();
  openGuideOnFirstInstall(reason);
});

chrome.runtime.onStartup.addListener(initialize);
