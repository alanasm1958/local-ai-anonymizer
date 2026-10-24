// Storage access for the service worker. Settings persist in
// chrome.storage.local; the vault lives only in chrome.storage.session
// (memory only, cleared when the browser closes).

import { mergeSettings } from '../core/settings.js';
import { createVault, isVault } from '../core/vault.js';
import { emptyStats } from '../core/report.js';

const SETTINGS_KEY = 'settings';
const VAULT_KEY = 'vault';
// Session counters for the Vault tab (runs and mentions per type). Memory only,
// cleared with the vault.
const STATS_KEY = 'stats';
// Only the per-type counts, never values. Survives browser restarts and
// extension updates so placeholder numbers are never handed out twice.
const COUNTERS_KEY = 'placeholderCounters';

export async function getSettings() {
  const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(stored);
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = mergeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getVault() {
  const { [VAULT_KEY]: stored } = await chrome.storage.session.get(VAULT_KEY);
  if (isVault(stored)) return stored;
  const { [COUNTERS_KEY]: counters } = await chrome.storage.local.get(COUNTERS_KEY);
  return createVault(counters && typeof counters === 'object' ? counters : {});
}

export const setVault = (vault) => Promise.all([
  chrome.storage.session.set({ [VAULT_KEY]: vault }),
  chrome.storage.local.set({ [COUNTERS_KEY]: vault.counters }),
]);

export const clearVault = () => chrome.storage.session.remove([VAULT_KEY, STATS_KEY]);

export async function getStats() {
  const { [STATS_KEY]: stored } = await chrome.storage.session.get(STATS_KEY);
  return stored && typeof stored === 'object' && Number.isFinite(stored.runs) ? stored : emptyStats();
}

export const setStats = (stats) => chrome.storage.session.set({ [STATS_KEY]: stats });

// Serializes read-modify-write cycles on the vault so concurrent pastes
// cannot hand out the same placeholder twice.
let queue = Promise.resolve();
export function withVaultLock(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// Calling any extension API resets the MV3 idle timer, which keeps the worker
// alive while a slow local model is still thinking.
export async function keepAlive(task) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}
