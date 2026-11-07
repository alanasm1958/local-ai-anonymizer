// Measures how much sensitive data survives anonymization, per detector setup.
// Usage: node scripts/eval-ner.mjs [--places] [modelId ...]
// Runs the real pipeline (patterns + NER) in Node via onnxruntime-node.

import { pipeline } from '@huggingface/transformers';
import { anonymize } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS, BUILTIN_MODEL_TYPES } from '../src/core/settings.js';
import { detectWithModel, BUILTIN_MODEL } from '../src/core/ner.js';
import { vocabularyLookup } from '../src/core/truecase.js';
import { SAMPLES } from '../tests/eval/samples.js';

const DEFAULT_MODELS = [BUILTIN_MODEL.id, 'Xenova/bert-base-NER'];
const WITH_PLACES = process.argv.includes('--places');
const BASE_SETTINGS = WITH_PLACES
  ? { ...DEFAULT_SETTINGS, modelTypes: { ...DEFAULT_SETTINGS.modelTypes, LOCATION: true } }
  : DEFAULT_SETTINGS;

async function score(label, detectEntities) {
  let caught = 0;
  let total = 0;
  let kept = 0;
  let keepTotal = 0;
  const missed = [];
  const overRedacted = [];
  const started = Date.now();
  for (const sample of SAMPLES) {
    const settings = { ...BASE_SETTINGS, useModel: Boolean(detectEntities) };
    const { text } = await anonymize(sample.text, {
      settings, vault: createVault(), detectEntities: detectEntities ?? (async () => []),
    });
    sample.sensitive.forEach((s) => {
      total += 1;
      if (text.includes(s)) missed.push(s);
      else caught += 1;
    });
    sample.keep.forEach((k) => {
      keepTotal += 1;
      if (text.includes(k)) kept += 1;
      else overRedacted.push(k);
    });
  }
  const ms = (Date.now() - started) / SAMPLES.length;
  return { label, recall: caught / total, keepRate: kept / keepTotal, msPerSample: ms, missed, overRedacted };
}

function print(result) {
  console.log(`\n## ${result.label}`);
  console.log(`caught ${(result.recall * 100).toFixed(1)}% of sensitive values | kept ${(result.keepRate * 100).toFixed(1)}% of safe phrases | ${result.msPerSample.toFixed(0)} ms/sample`);
  if (result.missed.length) console.log(`missed: ${result.missed.join(' | ')}`);
  if (result.overRedacted.length) console.log(`over-redacted: ${result.overRedacted.join(' | ')}`);
}

const modelArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const models = modelArgs.length ? modelArgs : DEFAULT_MODELS;
if (WITH_PLACES) console.log('(places enabled)');
const results = [await score('patterns only', null)];
for (const id of models) {
  const loadStart = Date.now();
  const ner = await pipeline('token-classification', id, { dtype: 'q8' });
  console.error(`${id} loaded in ${Date.now() - loadStart} ms`);
  const runModel = (chunk) => ner(chunk, { ignore_labels: [] });
  const countTokens = (chunk) => ner.tokenizer(chunk).input_ids.dims.at(-1);
  const isKnownWord = vocabularyLookup(ner.tokenizer.get_vocab());
  results.push(await score(id, (text) => detectWithModel(text, runModel, BUILTIN_MODEL_TYPES, { countTokens, isKnownWord })));
}
results.forEach(print);
