// Layer 1 of the MENA stress suite: every generated case (tests/stress/)
// through the real anonymize() pipeline with the real bundled model, twice
// (determinism), then restored (round trip). Writes a CSV of every case and a
// JSON summary to test-results/.
// Usage: node scripts/stress.mjs [--only person-full,phone] [--limit 200]

import { mkdir, writeFile } from 'node:fs/promises';
import { pipeline } from '@huggingface/transformers';
import { anonymize, restoreText } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS, BUILTIN_MODEL_TYPES } from '../src/core/settings.js';
import { detectWithModel, BUILTIN_MODEL } from '../src/core/ner.js';
import { vocabularyLookup } from '../src/core/truecase.js';
import { generateCases } from '../tests/stress/generate.js';
import { judgeCase } from '../tests/stress/oracle.js';

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const only = argValue('--only')?.split(',');
const limit = Number(argValue('--limit') ?? Infinity);
const stamp = new Date().toISOString().slice(0, 10);
const OUT_DIR = 'test-results';

const ner = await pipeline('token-classification', BUILTIN_MODEL.id, { dtype: BUILTIN_MODEL.dtype });
const isKnownWord = vocabularyLookup(ner.tokenizer.get_vocab());
const detectEntities = (text) => detectWithModel(text, (chunk) => ner(chunk, { ignore_labels: [] }), BUILTIN_MODEL_TYPES, {
  countTokens: (chunk) => ner.tokenizer(chunk).input_ids.dims.at(-1),
  isKnownWord,
});

const runOnce = (text) => anonymize(text, { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities });

function restoreStatus(input, result) {
  const restored = restoreText(result.text, result.vault).text;
  if (restored === input) return 'exact';
  return restored.toLowerCase() === input.toLowerCase() ? 'case-only' : 'differs';
}

async function runCase(kase) {
  const started = performance.now();
  const first = await runOnce(kase.text);
  const ms = Math.round(performance.now() - started);
  const second = await runOnce(kase.text);
  const judged = judgeCase(kase, first.text);
  return {
    ...kase,
    output: first.text,
    ...judged,
    caughtBy: [...new Set(first.replacements.map((r) => `${r.type}:${r.source}`))].join(' '),
    deterministic: first.text === second.text,
    restore: restoreStatus(kase.text, first),
    warnings: first.warnings.join(' '),
    ms,
  };
}

const csvCell = (v) => {
  const s = Array.isArray(v) ? v.join(' | ') : String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const COLUMNS = ['id', 'family', 'subtype', 'variant', 'context', 'trap', 'expected', 'reason', 'verdict', 'leaked', 'overRedacted', 'caughtBy', 'deterministic', 'restore', 'ms', 'text', 'output', 'warnings'];
const toCsv = (rows) => [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(c === 'text' || c === 'output' ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n');

function summarize(rows) {
  const families = [...new Set(rows.map((r) => r.family))];
  const tally = (list) => list.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  const byFamily = Object.fromEntries(families.map((f) => [f, tally(rows.filter((r) => r.family === f))]));
  const byVariant = Object.fromEntries(['title', 'lower', 'upper', 'mixed', 'first'].map((v) =>
    [v, tally(rows.filter((r) => r.variant === v && r.expected === 'must_catch'))]));
  const byTrap = Object.fromEntries([...new Set(rows.map((r) => r.trap).filter(Boolean))].map((t) => [t, tally(rows.filter((r) => r.trap === t))]));
  return {
    total: rows.length,
    verdicts: tally(rows),
    byFamily,
    byVariant,
    byTrap,
    nonDeterministic: rows.filter((r) => !r.deterministic).map((r) => r.id),
    restoreDiffers: rows.filter((r) => r.restore === 'differs').map((r) => r.id),
    restoreCaseOnly: rows.filter((r) => r.restore === 'case-only').length,
    medianMs: [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  };
}

const cases = generateCases().filter((c) => !only || only.includes(c.family)).slice(0, limit);
const rows = [];
for (const [i, kase] of cases.entries()) {
  rows.push(await runCase(kase));
  if ((i + 1) % 250 === 0) process.stdout.write(`${i + 1}/${cases.length}\n`);
}

const summary = summarize(rows);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/stress-${stamp}.csv`, toCsv(rows));
await writeFile(`${OUT_DIR}/stress-${stamp}.json`, JSON.stringify({ summary, failures: rows.filter((r) => r.verdict === 'fail') }, null, 2));

console.log(`\n${summary.total} cases: ${JSON.stringify(summary.verdicts)}`);
console.table(summary.byFamily);
console.log(`non-deterministic: ${summary.nonDeterministic.length}, restore differs: ${summary.restoreDiffers.length}, restore case-only: ${summary.restoreCaseOnly}`);
console.log(`wrote ${OUT_DIR}/stress-${stamp}.csv and .json`);
process.exitCode = summary.verdicts.fail ? 1 : 0;
