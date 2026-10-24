// Browser integrations that depend on settings: the Origin-stripping rule for
// the local model, content scripts for user-added sites, and the badge.

import { vaultSize } from '../core/vault.js';

const ORIGIN_RULE_ID = 1;
const CUSTOM_SCRIPT_ID = 'custom-sites';
const CONTENT_SCRIPT = 'src/content/content.js';

// Ollama rejects chrome-extension:// origins unless OLLAMA_ORIGINS is set.
// Removing the header only for requests this extension starts keeps web
// pages from abusing the same rule to reach the local model.
// Settings can be saved from several pages at once and the worker also syncs
// on startup; chaining keeps unregister/register pairs from interleaving.
let syncQueue = Promise.resolve();
const serialized = (task) => {
  const run = syncQueue.then(task, task);
  syncQueue = run.catch(() => undefined);
  return run;
};

export const syncOriginRule = (settings) => serialized(() => applyOriginRule(settings));
export const syncCustomSites = (settings) => serialized(() => applyCustomSites(settings));

async function applyOriginRule(settings) {
  let hostname;
  try {
    hostname = new URL(settings.endpoint).hostname.replace(/^\[|\]$/g, '');
  } catch {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ORIGIN_RULE_ID] });
    return;
  }
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules: [{
      id: ORIGIN_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'origin', operation: 'remove' }],
      },
      condition: {
        requestDomains: [hostname],
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
}

const patternsFor = (host) => [`https://${host}/*`, `https://*.${host}/*`];

async function grantedSites(hosts) {
  const checks = await Promise.all(
    hosts.map(async (host) => ((await chrome.permissions.contains({ origins: patternsFor(host) })) ? host : null)),
  );
  return checks.filter(Boolean);
}

async function applyCustomSites(settings) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
  if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_SCRIPT_ID] });

  const hosts = await grantedSites(settings.customSites);
  if (hosts.length === 0) return;
  await chrome.scripting.registerContentScripts([{
    id: CUSTOM_SCRIPT_ID,
    matches: hosts.flatMap(patternsFor),
    js: [CONTENT_SCRIPT],
    runAt: 'document_start',
    allFrames: true,
    persistAcrossSessions: true,
  }]);
}

export async function updateBadge(vault) {
  const size = vaultSize(vault);
  await chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  await chrome.action.setBadgeText({ text: size > 0 ? String(Math.min(size, 999)) : '' });
}

// Used for pages without our content script (context menu or shortcut on an
// arbitrary tab). activeTab grants access for that one interaction.
export async function ensureContentScript(tabId, frameId = 0) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: [CONTENT_SCRIPT] });
  }
}
