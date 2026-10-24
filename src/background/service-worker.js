// Message router. Every reply uses the envelope { ok, data?, error? }.

import { anonymize, restoreText } from '../core/anonymizer.js';
import { createModelClient } from '../core/llm.js';
import { isSiteEnabled, enabledTypes } from '../core/settings.js';
import { vaultEntries } from '../core/vault.js';
import {
  getSettings, saveSettings, getVault, setVault, clearVault, withVaultLock, keepAlive,
} from './state.js';
import { syncOriginRule, syncCustomSites, updateBadge, ensureContentScript } from './integrations.js';

const MAX_TEXT_LENGTH = 200000;
const TEST_SAMPLE = 'Hi, I am Maria Gonzalez from Northwind Traders. Please call me back about invoice 48213.';

const clientFor = (settings) => createModelClient({
  provider: settings.provider,
  endpoint: settings.endpoint,
  model: settings.model,
  timeoutMs: settings.timeoutMs,
});

function requireText(text) {
  if (typeof text !== 'string') throw new Error('Expected text to anonymize');
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`Text is too long (max ${MAX_TEXT_LENGTH.toLocaleString()} characters)`);
  return text;
}

async function handleAnonymize({ text }) {
  const input = requireText(text);
  const settings = await getSettings();
  const client = clientFor(settings);
  return withVaultLock(() => keepAlive(async () => {
    const result = await anonymize(input, { settings, vault: await getVault(), detectEntities: client.detectEntities });
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
  return { active: isSiteEnabled(settings, hostname), interceptPaste: settings.interceptPaste };
}

async function handleSaveSettings({ patch }) {
  const settings = await saveSettings(patch ?? {});
  await Promise.all([syncOriginRule(settings), syncCustomSites(settings)]);
  return settings;
}

async function handleClearVault() {
  await withVaultLock(clearVault);
  await updateBadge(await getVault());
  return true;
}

// Content scripts run inside AI pages, so they only get what paste
// protection needs. The vault and settings are for extension pages only.
const CONTENT_HANDLERS = Object.freeze({
  anonymize: handleAnonymize,
  restore: handleRestore,
  siteStatus: handleSiteStatus,
});

const PAGE_HANDLERS = Object.freeze({
  ...CONTENT_HANDLERS,
  testModel: handleTestModel,
  listModels: handleListModels,
  getSettings: () => getSettings(),
  saveSettings: handleSaveSettings,
  getVault: async () => vaultEntries(await getVault()),
  clearVault: handleClearVault,
});

const isExtensionPage = (sender) => sender.url?.startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handlers = isExtensionPage(sender) ? PAGE_HANDLERS : CONTENT_HANDLERS;
  const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : null;
  if (!handler) return false;
  handler(message)
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
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    MENU_ITEMS.forEach((item) => chrome.contextMenus.create({ ...item, contexts: ['selection'] }));
  });
  initialize();
});

chrome.runtime.onStartup.addListener(initialize);
