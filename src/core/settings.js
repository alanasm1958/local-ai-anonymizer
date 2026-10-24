// Settings schema, defaults and validation. Pure: no chrome.* calls.

export const PATTERN_TYPES = Object.freeze([
  'EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IP_ADDRESS', 'IBAN', 'API_KEY',
  'DATE_OF_BIRTH', 'ID_NUMBER', 'ADDRESS', 'POSTCODE', 'URL',
]);

export const MODEL_TYPES = Object.freeze([
  'PERSON', 'ORGANIZATION', 'ADDRESS', 'LOCATION', 'ID_NUMBER',
]);

// What the bundled NER model can recognise. Addresses and ID numbers come
// from the pattern rules, or from Ollama if the user switches to it.
export const BUILTIN_MODEL_TYPES = Object.freeze(['PERSON', 'ORGANIZATION', 'LOCATION']);

export const TYPE_LABELS = Object.freeze({
  EMAIL: 'Email addresses',
  PHONE: 'Phone numbers',
  CREDIT_CARD: 'Credit card numbers',
  SSN: 'US Social Security numbers',
  IP_ADDRESS: 'IP addresses',
  IBAN: 'IBAN bank accounts',
  API_KEY: 'API keys, tokens, passwords',
  URL: 'URLs',
  DATE_OF_BIRTH: 'Dates of birth (after "DOB", "born on")',
  POSTCODE: 'UK postcodes, US state + ZIP',
  PERSON: 'People\'s names',
  ORGANIZATION: 'Companies and organizations',
  ADDRESS: 'Street addresses',
  LOCATION: 'Cities, countries, places',
  ID_NUMBER: 'ID, passport, account and case numbers',
});

export const DEFAULT_SITES = Object.freeze([
  'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'perplexity.ai', 'chat.deepseek.com',
  'chat.mistral.ai', 'grok.com', 'poe.com',
]);

export const PROVIDERS = Object.freeze({
  builtin: { label: 'Built-in model (no install)', endpoint: null },
  ollama: { label: 'Ollama', endpoint: 'http://localhost:11434' },
  openai: { label: 'OpenAI-compatible (LM Studio, llama.cpp, vLLM)', endpoint: 'http://localhost:1234/v1' },
});

const ON_MODEL_ERROR = Object.freeze(['patterns', 'cancel']);
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

const typeMap = (types, enabledByDefault) =>
  Object.freeze(Object.fromEntries(types.map((t) => [t, enabledByDefault(t)])));

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  interceptPaste: true,
  restoreReplies: true,
  checkFiles: true,
  holdUncheckedFiles: true,
  useModel: true,
  provider: 'builtin',
  endpoint: PROVIDERS.ollama.endpoint,
  model: 'llama3.2',
  timeoutMs: 60000,
  onModelError: 'patterns',
  patternTypes: typeMap(PATTERN_TYPES, (t) => t !== 'URL'),
  // Places on by default: the eval set went from 90% to 99% recall with no
  // extra over-redaction (scripts/eval-ner.mjs --places).
  modelTypes: typeMap(MODEL_TYPES, () => true),
  customSites: Object.freeze([]),
  disabledSites: Object.freeze([]),
});

const pickBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const pickTypeMap = (stored, defaults) => {
  const source = stored && typeof stored === 'object' ? stored : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([type, def]) => [type, pickBool(source[type], def)]),
  );
};

const isHttpUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const pickHosts = (value) =>
  Array.isArray(value)
    ? [...new Set(value.filter((h) => typeof h === 'string').map(normalizeHost).filter(Boolean))]
    : [];

export function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  let host;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return '';
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/.test(host)) return '';
  return host.replace(/^www\./, '');
}

export function mergeSettings(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const provider = Object.hasOwn(PROVIDERS, s.provider) ? s.provider : DEFAULT_SETTINGS.provider;
  const timeout = Number.isFinite(s.timeoutMs) && s.timeoutMs >= MIN_TIMEOUT_MS && s.timeoutMs <= MAX_TIMEOUT_MS
    ? s.timeoutMs
    : DEFAULT_SETTINGS.timeoutMs;
  return {
    enabled: pickBool(s.enabled, DEFAULT_SETTINGS.enabled),
    interceptPaste: pickBool(s.interceptPaste, DEFAULT_SETTINGS.interceptPaste),
    restoreReplies: pickBool(s.restoreReplies, DEFAULT_SETTINGS.restoreReplies),
    checkFiles: pickBool(s.checkFiles, DEFAULT_SETTINGS.checkFiles),
    holdUncheckedFiles: pickBool(s.holdUncheckedFiles, DEFAULT_SETTINGS.holdUncheckedFiles),
    useModel: pickBool(s.useModel, DEFAULT_SETTINGS.useModel),
    provider,
    endpoint: isHttpUrl(s.endpoint) ? s.endpoint.trim() : DEFAULT_SETTINGS.endpoint,
    model: typeof s.model === 'string' && s.model.trim() ? s.model.trim() : DEFAULT_SETTINGS.model,
    timeoutMs: timeout,
    onModelError: ON_MODEL_ERROR.includes(s.onModelError) ? s.onModelError : DEFAULT_SETTINGS.onModelError,
    patternTypes: pickTypeMap(s.patternTypes, DEFAULT_SETTINGS.patternTypes),
    modelTypes: pickTypeMap(s.modelTypes, DEFAULT_SETTINGS.modelTypes),
    customSites: pickHosts(s.customSites),
    disabledSites: pickHosts(s.disabledSites),
  };
}

const hostMatches = (hostname, site) => hostname === site || hostname.endsWith(`.${site}`);

export function isSiteEnabled(settings, hostname) {
  if (!settings.enabled) return false;
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (settings.disabledSites.some((site) => hostMatches(host, site))) return false;
  return [...DEFAULT_SITES, ...settings.customSites].some((site) => hostMatches(host, site));
}

export function isLocalEndpoint(endpoint) {
  if (!isHttpUrl(endpoint)) return false;
  const { hostname } = new URL(endpoint);
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export const enabledTypes = (typeMapObj) =>
  Object.entries(typeMapObj).filter(([, on]) => on).map(([type]) => type);
