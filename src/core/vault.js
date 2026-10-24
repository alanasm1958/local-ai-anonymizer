// Placeholder vault: maps [TYPE_N] placeholders to original values.
// Immutable: every update returns a new vault object. Plain JSON so it can
// live in chrome.storage.session.

const CASE_INSENSITIVE_TYPES = new Set(['PERSON', 'ORGANIZATION', 'EMAIL', 'LOCATION', 'ADDRESS', 'URL']);

export const PLACEHOLDER_RE = /\[([A-Z][A-Z_]*?)_(\d+)\]/g;

// `counters` lets a fresh vault continue numbering after a reset, so an old
// [PERSON_1] in a chat can never be restored to a different person.
export function createVault(counters = {}) {
  return { byPlaceholder: {}, byKey: {}, counters: { ...counters } };
}

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

// Batch version: copies the vault once, then fills the private copy. The input
// vault is never touched; if nothing new was added it is returned as-is.
export function assignPlaceholders(vault, items) {
  let draft = null;
  const placeholders = items.map(({ type, value }) => {
    const key = keyFor(type, value);
    const existing = (draft ?? vault).byKey[key];
    if (existing) return existing;
    draft ??= {
      byPlaceholder: { ...vault.byPlaceholder },
      byKey: { ...vault.byKey },
      counters: { ...vault.counters },
    };
    const next = (draft.counters[type] ?? 0) + 1;
    const placeholder = `[${type}_${next}]`;
    draft.counters[type] = next;
    draft.byKey[key] = placeholder;
    draft.byPlaceholder[placeholder] = value;
    return placeholder;
  });
  return { vault: draft ?? vault, placeholders };
}

export function assignPlaceholder(vault, type, value) {
  const { vault: next, placeholders } = assignPlaceholders(vault, [{ type, value }]);
  return { vault: next, placeholder: placeholders[0] };
}

export const lookupPlaceholder = (vault, placeholder) => vault.byPlaceholder[placeholder];

export const vaultSize = (vault) => Object.keys(vault.byPlaceholder).length;

export const vaultEntries = (vault) =>
  Object.entries(vault.byPlaceholder).map(([placeholder, original]) => ({ placeholder, original }));
