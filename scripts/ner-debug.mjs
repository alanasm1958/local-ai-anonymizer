// Prints raw model tokens and the final anonymized text for each argument.
// Usage: node scripts/ner-debug.mjs "text one" "text two"
import { pipeline } from '@huggingface/transformers';
import { anonymize } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS, BUILTIN_MODEL_TYPES } from '../src/core/settings.js';
import { detectWithModel, BUILTIN_MODEL } from '../src/core/ner.js';
import { truecase, vocabularyLookup } from '../src/core/truecase.js';

const ner = await pipeline('token-classification', BUILTIN_MODEL.id, { dtype: BUILTIN_MODEL.dtype });
const isKnownWord = vocabularyLookup(ner.tokenizer.get_vocab());
const detectEntities = (text) => detectWithModel(text, (chunk) => ner(chunk, { ignore_labels: [] }), BUILTIN_MODEL_TYPES, {
  countTokens: (chunk) => ner.tokenizer(chunk).input_ids.dims.at(-1), isKnownWord,
});
for (const text of process.argv.slice(2)) {
  const seen = truecase(text, isKnownWord);
  const tokens = await ner(seen, { ignore_labels: [] });
  console.log(`\n${JSON.stringify(text)}\n  model reads: ${JSON.stringify(seen)}`);
  console.log(`  tokens: ${tokens.map((t) => `${t.word}/${t.entity}:${t.score.toFixed(2)}`).join(' ')}`);
  const r = await anonymize(text, { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities });
  console.log(`  output: ${JSON.stringify(r.text)}`);
}
