import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignTokens, detectWithModel, NER_MIN_SCORE, BUILTIN_MODEL } from '../src/core/ner.js';

const tok = (word, entity, score = 0.99) => ({ word, entity, score });

// Token sequence captured from onnx-community/distilbert-NER-ONNX (q8).
const PROBE_TEXT = "Hi, I'm Maria O'Brien-Gonzalez from Northwind Traders in Leeds. Email Jean-Luc Picard at Starfleet.";
const PROBE_TOKENS = [
  tok('Hi', 'O'), tok(',', 'O'), tok('I', 'O'), tok("'", 'O'), tok('m', 'O'),
  tok('Maria', 'B-PER'), tok('O', 'I-PER'), tok("'", 'I-PER'), tok('Brien', 'I-PER'),
  tok('-', 'O'), tok('Gonzalez', 'B-PER', 0.61),
  tok('from', 'O'),
  tok('North', 'B-ORG'), tok('##wind', 'B-ORG'), tok('Trade', 'I-ORG'), tok('##rs', 'I-ORG'),
  tok('in', 'O'), tok('Leeds', 'B-LOC'), tok('.', 'O'),
  tok('Em', 'B-PER', 0.79), tok('##ail', 'B-PER', 0.85), tok('Jean', 'I-PER', 0.8),
  tok('-', 'I-PER', 0.49), tok('Luc', 'I-PER', 0.93), tok('Pi', 'I-PER'), tok('##card', 'I-PER'),
  tok('at', 'O'), tok('Star', 'B-ORG', 0.76), tok('##fle', 'B-ORG', 0.81), tok('##et', 'B-ORG', 0.97), tok('.', 'O'),
];

const pairs = (entities) => entities.map((e) => [e.text, e.type]);

test('alignTokens rebuilds whole entities from word pieces', () => {
  assert.deepEqual(pairs(alignTokens(PROBE_TEXT, PROBE_TOKENS)), [
    ["Maria O'Brien-Gonzalez", 'PERSON'],
    ['Northwind Traders', 'ORGANIZATION'],
    ['Leeds', 'LOCATION'],
    ['Jean-Luc Picard', 'PERSON'],
    ['Starfleet', 'ORGANIZATION'],
  ]);
});

test('alignTokens reports offsets that match the text', () => {
  for (const e of alignTokens(PROBE_TEXT, PROBE_TOKENS)) {
    assert.equal(PROBE_TEXT.slice(e.start, e.end), e.text);
  }
});

test('alignTokens trims leading command words the model mistakes for names', () => {
  const text = 'Dear Ana Lima, call Bo Chen.';
  const tokens = [
    tok('Dear', 'B-PER'), tok('Ana', 'I-PER'), tok('Lima', 'I-PER'), tok(',', 'O'),
    tok('call', 'O'), tok('Bo', 'B-PER'), tok('Chen', 'I-PER'), tok('.', 'O'),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Ana Lima', 'PERSON'], ['Bo Chen', 'PERSON']]);
});

test('alignTokens drops low-confidence entities and MISC', () => {
  const text = 'Visit Paris with French friends';
  const tokens = [
    tok('Visit', 'O'), tok('Paris', 'B-LOC', NER_MIN_SCORE - 0.1), tok('with', 'O'),
    tok('French', 'B-MISC'), tok('friends', 'O'),
  ];
  assert.deepEqual(alignTokens(text, tokens), []);
});

test('alignTokens starts a new entity on B- even when adjacent', () => {
  const text = 'Ana Bo';
  const tokens = [tok('Ana', 'B-PER'), tok('Bo', 'B-PER')];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Ana', 'PERSON'], ['Bo', 'PERSON']]);
});

test('alignTokens treats an orphan I- tag as the start of an entity', () => {
  assert.deepEqual(pairs(alignTokens('met Zoe today', [tok('met', 'O'), tok('Zoe', 'I-PER'), tok('today', 'O')])), [['Zoe', 'PERSON']]);
});

test('alignTokens skips tokens it cannot find (e.g. [UNK]) without losing sync', () => {
  const text = 'Emoji 🙂 then Ana Lima';
  const tokens = [tok('Emoji', 'O'), tok('[UNK]', 'O'), tok('then', 'O'), tok('Ana', 'B-PER'), tok('Lima', 'I-PER')];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Ana Lima', 'PERSON']]);
});

test('alignTokens applies a chunk offset', () => {
  const [e] = alignTokens('Ana', [tok('Ana', 'B-PER')], { offset: 100 });
  assert.equal(e.start, 100);
  assert.equal(e.end, 103);
});

test('alignTokens handles empty input', () => {
  assert.deepEqual(alignTokens('', []), []);
});

test('detectWithModel chunks long text and maps offsets back', async () => {
  const text = `${'filler words here. '.repeat(80)}Contact Ana Lima today.`;
  const seen = [];
  const runModel = async (chunk) => {
    seen.push(chunk);
    return chunk.split(/(\s+|[.,])/).filter((w) => w.trim()).map((w) => ({
      word: w, entity: w === 'Ana' ? 'B-PER' : w === 'Lima' ? 'I-PER' : 'O', score: 0.99,
    }));
  };
  const entities = await detectWithModel(text, runModel, ['PERSON']);
  assert.ok(seen.length > 1, 'expected several chunks');
  assert.deepEqual(entities, [{ text: 'Ana Lima', type: 'PERSON' }]);
});

test('detectWithModel filters to requested types and dedupes', async () => {
  const runModel = async () => [
    { word: 'Ana', entity: 'B-PER', score: 0.99 }, { word: 'Acme', entity: 'B-ORG', score: 0.99 },
    { word: 'Ana', entity: 'B-PER', score: 0.99 },
  ];
  assert.deepEqual(await detectWithModel('Ana Acme Ana', runModel, ['PERSON']), [{ text: 'Ana', type: 'PERSON' }]);
  assert.deepEqual(await detectWithModel('   ', runModel, ['PERSON']), []);
});

test('alignTokens ignores field labels, acronyms and common tool names', () => {
  const text = 'DOB: 1990. KYC done in Excel by Ana Lima.';
  const tokens = [
    tok('DO', 'B-LOC'), tok('##B', 'I-LOC'), tok(':', 'O'), tok('1990', 'O'), tok('.', 'O'),
    tok('K', 'B-ORG'), tok('##Y', 'B-ORG'), tok('##C', 'B-ORG'), tok('done', 'O'), tok('in', 'O'),
    tok('Excel', 'B-ORG'), tok('by', 'O'), tok('Ana', 'B-PER'), tok('Lima', 'I-PER'), tok('.', 'O'),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Ana Lima', 'PERSON']]);
});

test('detectWithModel re-splits chunks that exceed the model token limit', async () => {
  const dense = 'x=a[i]+b(j);'.repeat(80);
  const text = `${dense} Please email Ana Lima about it.`;
  const seen = [];
  const runModel = async (chunk) => {
    seen.push(chunk);
    if (chunk.length > 450) return []; // a real model silently truncates
    return chunk.split(/(\s+|[.,])/).filter((w) => w.trim()).map((w) => ({
      word: w, entity: w === 'Ana' ? 'B-PER' : w === 'Lima' ? 'I-PER' : 'O', score: 0.99,
    }));
  };
  const countTokens = (chunk) => chunk.length; // pretend one token per character
  const entities = await detectWithModel(text, runModel, ['PERSON'], { countTokens, maxTokens: 450 });
  assert.ok(seen.every((c) => c.length <= 450), 'every chunk must fit');
  assert.deepEqual(entities, [{ text: 'Ana Lima', type: 'PERSON' }]);
});

test('BUILTIN_MODEL pins an exact model revision', () => {
  assert.match(BUILTIN_MODEL.revision, /^[0-9a-f]{40}$/);
});
