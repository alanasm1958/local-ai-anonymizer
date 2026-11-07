// Runs every text scenario (tests/scenarios/cases.js) through the real
// pipeline in Node: patterns + the bundled model + truecasing, then restores
// the result and checks the round trip. Browser delivery is covered by
// tests/e2e/scenarios.e2e.js.
// Usage: node scripts/scenarios.mjs [--json <file>] [--only S01,S02]

import { writeFile } from 'node:fs/promises';
import { pipeline } from '@huggingface/transformers';
import { anonymize, restoreText } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS, BUILTIN_MODEL_TYPES } from '../src/core/settings.js';
import { detectWithModel, BUILTIN_MODEL } from '../src/core/ner.js';
import { vocabularyLookup } from '../src/core/truecase.js';
import { CASES } from '../tests/scenarios/cases.js';
import { judge } from '../tests/scenarios/check.js';

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const only = argValue('--only')?.split(',');
const jsonPath = argValue('--json');

const ner = await pipeline('token-classification', BUILTIN_MODEL.id, { dtype: BUILTIN_MODEL.dtype });
const isKnownWord = vocabularyLookup(ner.tokenizer.get_vocab());
const detectEntities = (text) => detectWithModel(text, (chunk) => ner(chunk, { ignore_labels: [] }), BUILTIN_MODEL_TYPES, {
  countTokens: (chunk) => ner.tokenizer(chunk).input_ids.dims.at(-1),
  isKnownWord,
});

async function runCase(kase) {
  const started = Date.now();
  const result = await anonymize(kase.text, { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities });
  const verdict = judge(result.text, kase);
  // One placeholder covers several spellings ("omar farouk" / "Omar Farouk"),
  // so only case may differ. Anything else (lost or doubled text) is counted.
  const restored = restoreText(result.text, result.vault).text;
  const roundTrip = restored.toLowerCase() === kase.text.toLowerCase();
  return { id: kase.id, title: kase.title, group: kase.group, ms: Date.now() - started, output: result.text, restored, roundTrip, ...verdict };
}

const selected = CASES.filter((c) => c.text && (!only || only.includes(c.id)));
const results = [];
for (const kase of selected) results.push(await runCase(kase));

const line = (r) => {
  const notes = [
    r.leaked.length ? `leaked: ${r.leaked.join(' | ')}` : '',
    r.overRedacted.length ? `over-redacted: ${r.overRedacted.join(' | ')}` : '',
    r.knownLeft.length ? `known gap left: ${r.knownLeft.join(' | ')}` : '',
    ...r.notes,
  ].filter(Boolean).join('; ');
  const detail = notes ? `\n        ${notes}\n        output: ${JSON.stringify(r.output)}` : '';
  const restoreNote = r.roundTrip ? '' : `\n        restored (differs): ${JSON.stringify(r.restored)}`;
  return `${r.status.toUpperCase().padEnd(5)} ${r.id} ${r.title}${detail}${restoreNote}`;
};
results.forEach((r) => console.log(line(r)));

const count = (s) => results.filter((r) => r.status === s).length;
const restoreDiffers = results.filter((r) => !r.roundTrip).map((r) => r.id);
console.log(`\n${results.length} text scenarios: ${count('pass')} pass, ${count('fail')} fail, ${count('known')} known gap, ${count('fixed')} known gap now fixed`);
console.log(`restore gives back more than a case change in ${restoreDiffers.length}: ${restoreDiffers.join(', ') || 'none'}`);
if (jsonPath) await writeFile(jsonPath, JSON.stringify(results, null, 2));
process.exitCode = count('fail') ? 1 : 0;
