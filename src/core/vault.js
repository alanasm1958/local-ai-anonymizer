// Placeholder vault: maps [TYPE_N] placeholders to original values.
// Immutable: every update returns a new vault object. Plain JSON so it can
// live in chrome.storage.session.

const CASE_INSENSITIVE_TYPES = new Set(['PERSON', 'ORGANIZATION', 'EMAIL', 'LOCATION', 'ADDRESS', 'URL']);

export const PLACEHOLDER_RE = /\[([A-Z][A-Z_]*?)_(\d+)\]/g;

// `counters` lets a fresh vault continue numbering after a reset, so an old
// [PERSON_1] in a chat can never be restored to a different person.
export function createVault(counters = {}) {
  return { byPlaceholder: {}, byKey: {}, counters: { ...counters }, sites: {} };
}

// Value came from an extension page (popup), not a website: any site may show it.
export const ANY_SITE = '*';

// Types shown in place inside AI replies. Secrets and identifiers stay as
// placeholders on the page (restore them in the popup): even hidden in a
// shadow root, revealed text has a measurable width.
const REVEALABLE_TYPES = new Set(['PERSON', 'ORGANIZATION', 'LOCATION', 'ADDRESS', 'POSTCODE', 'EMAIL', 'PHONE', 'URL']);

export const isRevealable = (placeholder) =>
  REVEALABLE_TYPES.has(/^\[([A-Z][A-Z_]*?)_\d+\]$/.exec(placeholder)?.[1]);

export function isVault(value) {
  return Boolean(
    value && typeof value === 'object'
    && value.byPlaceholder && typeof value.byPlaceholder === 'object'
    && value.byKey && typeof value.byKey === 'object'
    && value.counters && typeof value.counters === 'object',
  );
}

const keyFor = (type, value) => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return `${type}:${CASE_INSENSITIVE_TYPES.has(type) ? normalized.toLowerCase() : normalized}`;
};

const sitesOf = (vault, placeholder) => vault.sites?.[placeholder] ?? [];

// Batch version: copies the vault once, then fills the private copy. The input
// vault is never touched; if nothing changed it is returned as-is.
// `site` records where each value was pasted, so replies on other sites
// cannot be used to probe for it.
export function assignPlaceholders(vault, items, { site = ANY_SITE } = {}) {
  let draft = null;
  const edit = () => {
    draft ??= {
      byPlaceholder: { ...vault.byPlaceholder },
      byKey: { ...vault.byKey },
      counters: { ...vault.counters },
      sites: { ...vault.sites },
    };
    return draft;
  };
  const noteSite = (placeholder) => {
    const current = sitesOf(draft ?? vault, placeholder);
    if (!current.includes(site)) edit().sites[placeholder] = [...current, site];
  };
  const placeholders = items.map(({ type, value }) => {
    const key = keyFor(type, value);
    const existing = (draft ?? vault).byKey[key];
    if (existing) {
      noteSite(existing);
      return existing;
    }
    const d = edit();
    const next = (d.counters[type] ?? 0) + 1;
    const placeholder = `[${type}_${next}]`;
    d.counters[type] = next;
    d.byKey[key] = placeholder;
    d.byPlaceholder[placeholder] = value;
    noteSite(placeholder);
    return placeholder;
  });
  return { vault: draft ?? vault, placeholders };
}

export function lookupForSite(vault, placeholder, site) {
  const sites = sitesOf(vault, placeholder);
  return sites.includes(site) || sites.includes(ANY_SITE) ? vault.byPlaceholder[placeholder] : undefined;
}

export function assignPlaceholder(vault, type, value) {
  const { vault: next, placeholders } = assignPlaceholders(vault, [{ type, value }]);
  return { vault: next, placeholder: placeholders[0] };
}

export const lookupPlaceholder = (vault, placeholder) => vault.byPlaceholder[placeholder];

export const vaultSize = (vault) => Object.keys(vault.byPlaceholder).length;

export const vaultEntries = (vault) =>
  Object.entries(vault.byPlaceholder).map(([placeholder, original]) => ({ placeholder, original }));
