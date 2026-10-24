// Orchestrates detection and replacement. Pure apart from the injected
// detectEntities function, so it runs the same in Node tests and in the
// extension service worker.

import { detectPatterns } from './detectors.js';
import { entitiesToSpans } from './llm.js';
import { resolveSpans } from './spans.js';
import { assignPlaceholders, PLACEHOLDER_RE } from './vault.js';
import { enabledTypes } from './settings.js';
import { nameAliasSpans, partOwners } from './names.js';
import { orgSuffixSpans } from './orgs.js';
import { NEVER_ENTITIES } from './ner.js';

const MIN_KNOWN_LENGTH = 3;

export function applySpans(text, spans, vault, { site } = {}) {
  const resolved = resolveSpans(spans);
  // A lone "Maria" gets the placeholder of the full name it came from.
  const items = resolved.map((span) => ({ type: span.type, value: span.aliasOf ?? span.value }));
  const { vault: nextVault, placeholders } = assignPlaceholders(vault, items, { site });
  // Local buffer, joined once: linear even for pastes with thousands of hits.
  const parts = [];
  let cursor = 0;
  resolved.forEach((span, i) => {
    parts.push(text.slice(cursor, span.start), placeholders[i]);
    cursor = span.end;
  });
  parts.push(text.slice(cursor));
  return {
    text: parts.join(''),
    vault: nextVault,
    // start/end are offsets in the original text (used to rewrite Office files).
    replacements: resolved.map((span, i) => ({
      placeholder: placeholders[i], type: span.type, original: span.value, source: span.source, start: span.start, end: span.end,
    })),
  };
}

// Known placeholders in `text` with their real values, for restoring files
// where the text is spread across several XML elements.
export function placeholderSpans(text, vault) {
  return [...text.matchAll(PLACEHOLDER_RE)]
    .filter((m) => vault.byPlaceholder[m[0]] !== undefined)
    .map((m) => ({ start: m.index, end: m.index + m[0].length, text: vault.byPlaceholder[m[0]] }));
}

export function restoreText(text, vault) {
  let restoredCount = 0;
  let unknownCount = 0;
  const restored = text.replace(PLACEHOLDER_RE, (match) => {
    const original = vault.byPlaceholder[match];
    if (original === undefined) {
      unknownCount += 1;
      return match;
    }
    restoredCount += 1;
    return original;
  });
  return { text: restored, restoredCount, unknownCount };
}

// Model spans must not sit on top of existing placeholders like [PERSON_1].
function placeholderRanges(text) {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

const insideAny = (span, ranges) => ranges.some((r) => span.start < r.end && r.start < span.end);

async function detectWithModel(text, settings, detectEntities) {
  const types = enabledTypes(settings.modelTypes);
  if (!settings.useModel || types.length === 0) return [];
  return (await detectEntities(text, types)).filter((e) => types.includes(e.type));
}

const typeOf = (placeholder) => /^\[([A-Z][A-Z_]*?)_\d+\]$/.exec(placeholder)?.[1];

// Values found earlier in this session, of types still enabled. Short values
// and stoplisted words are skipped: one mis-tag ("IT" as a company) must not
// redact that word for the rest of the session.
function knownEntities(vault, settings) {
  if (!settings.useModel) return [];
  return Object.entries(vault.byPlaceholder)
    .map(([placeholder, value]) => ({ text: value, type: typeOf(placeholder) }))
    .filter((e) => settings.modelTypes[e.type] === true
      && e.text.length >= MIN_KNOWN_LENGTH && !NEVER_ENTITIES.has(e.text));
}

// Model spans plus exact repeats of known values plus lone name parts.
function entitySpans(text, settings, vault, found) {
  const candidates = [...found, ...knownEntities(vault, settings)];
  const owners = partOwners(candidates.filter((e) => e.type === 'PERSON').map((e) => e.text));
  // A lone "Maria" the model tagged itself is the known Maria Gonzalez, not
  // a new person: let the alias span (full name's placeholder) handle it.
  const isKnownPart = (e) => e.type === 'PERSON' && Boolean(owners.get(e.text.trim()));
  const reserved = placeholderRanges(text);
  // Part of "model detection" in Settings, so it follows the same switch.
  const orgRule = settings.useModel && settings.modelTypes.ORGANIZATION === true ? orgSuffixSpans(text) : [];
  return [...entitiesToSpans(text, candidates.filter((e) => !isKnownPart(e))), ...nameAliasSpans(text, owners), ...orgRule]
    .filter((s) => !insideAny(s, reserved));
}

// `site` is the host the text is being pasted into (omit for extension pages).
export async function anonymize(text, { settings, vault, detectEntities, site }) {
  if (!text) return { text, vault, replacements: [], warnings: [] };

  const patternSpans = detectPatterns(text, settings.patternTypes);
  const warnings = [];
  let found = [];
  try {
    found = await detectWithModel(text, settings, detectEntities);
  } catch (err) {
    if (settings.onModelError === 'cancel') throw err;
    warnings.push(`Local model unavailable, only patterns were used: ${err.message}`);
  }

  const spans = [...patternSpans, ...entitySpans(text, settings, vault, found)];
  const result = applySpans(text, spans, vault, { site });
  return { ...result, warnings };
}
