// Orchestrates detection and replacement. Pure apart from the injected
// detectEntities function, so it runs the same in Node tests and in the
// extension service worker.

import { detectPatterns } from './detectors.js';
import { entitiesToSpans } from './llm.js';
import { resolveSpans } from './spans.js';
import { assignPlaceholders, PLACEHOLDER_RE } from './vault.js';
import { enabledTypes } from './settings.js';

export function applySpans(text, spans, vault, { site } = {}) {
  const resolved = resolveSpans(spans);
  const { vault: nextVault, placeholders } = assignPlaceholders(vault, resolved, { site });
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
    replacements: resolved.map((span, i) => ({
      placeholder: placeholders[i], type: span.type, original: span.value, source: span.source,
    })),
  };
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

async function modelSpans(text, settings, detectEntities) {
  const types = enabledTypes(settings.modelTypes);
  if (!settings.useModel || types.length === 0) return [];
  const entities = (await detectEntities(text, types)).filter((e) => types.includes(e.type));
  const reserved = placeholderRanges(text);
  return entitiesToSpans(text, entities).filter((s) => !insideAny(s, reserved));
}

// `site` is the host the text is being pasted into (omit for extension pages).
export async function anonymize(text, { settings, vault, detectEntities, site }) {
  if (!text) return { text, vault, replacements: [], warnings: [] };

  const patternSpans = detectPatterns(text, settings.patternTypes);
  const warnings = [];
  let fromModel = [];
  try {
    fromModel = await modelSpans(text, settings, detectEntities);
  } catch (err) {
    if (settings.onModelError === 'cancel') throw err;
    warnings.push(`Local model unavailable, only patterns were used: ${err.message}`);
  }

  const result = applySpans(text, [...patternSpans, ...fromModel], vault, { site });
  return { ...result, warnings };
}
