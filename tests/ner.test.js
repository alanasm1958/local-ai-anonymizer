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

test('a place directly followed by an organization is one organization', () => {
  const text = 'Write to Northwind Traders and Leeds City Council in Leeds.';
  const tokens = [
    tok('Write', 'O'), tok('to', 'O'), tok('North', 'B-LOC'), tok('##wind', 'B-LOC'), tok('Trade', 'B-ORG'), tok('##rs', 'I-ORG'),
    tok('and', 'O'), tok('Leeds', 'B-LOC'), tok('City', 'B-ORG'), tok('Council', 'I-ORG'),
    tok('in', 'O'), tok('Leeds', 'B-LOC'), tok('.', 'O'),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [
    ['Northwind Traders', 'ORGANIZATION'], ['Leeds City Council', 'ORGANIZATION'], ['Leeds', 'LOCATION'],
  ]);
});

test('a low-confidence organization next to a place is not merged into it', () => {
  const tokens = [tok('London', 'B-LOC', 0.95), tok('Bridge', 'B-ORG', 0.3)];
  assert.deepEqual(pairs(alignTokens('London Bridge', tokens)), [['London', 'LOCATION']]);
});

test('place and organization are not merged when organizations are not wanted', () => {
  const tokens = [tok('Leeds', 'B-LOC'), tok('City', 'B-ORG'), tok('Council', 'I-ORG')];
  assert.deepEqual(pairs(alignTokens('Leeds City Council', tokens, { types: ['LOCATION'] })), [
    ['Leeds', 'LOCATION'], ['City Council', 'ORGANIZATION'],
  ]);
});

test('BUILTIN_MODEL lists every file the runtime needs', () => {
  for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', BUILTIN_MODEL.file]) {
    assert.ok(BUILTIN_MODEL.files.includes(f), f);
  }
});

// Captured from the built-in model: a command word at the start of the
// sentence drops its confidence and mislabels the surname as I-ORG.
test('an unsure person name after a command word is still caught whole', () => {
  const text = 'Call Priya Raman at Tata Consultancy Services on +91 98450 12345.';
  const tokens = [
    tok('Call', 'O', 0.94), tok('P', 'B-PER', 0.57), tok('##riya', 'B-PER', 0.48), tok('Rama', 'I-ORG', 0.47), tok('##n', 'O', 0.41),
    tok('at', 'O'), tok('Ta', 'B-ORG'), tok('##ta', 'B-ORG'), tok('Consul', 'I-ORG'), tok('##tan', 'I-ORG'), tok('##cy', 'I-ORG'), tok('Services', 'I-ORG'),
    tok('on', 'O'),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Priya Raman', 'PERSON'], ['Tata Consultancy Services', 'ORGANIZATION']]);
});

test('weak non-person entities still need the normal confidence', () => {
  const tokens = [tok('Visit', 'O'), tok('Leeds', 'B-LOC', 0.5)];
  assert.deepEqual(alignTokens('Visit Leeds', tokens), []);
});

test('a single unsure word tagged as a person still needs the normal confidence', () => {
  const tokens = [tok('Stack', 'B-PER', 0.5), tok('trace', 'O'), tok('mentions', 'O')];
  assert.deepEqual(alignTokens('Stack trace mentions', tokens), []);
});

// Captured from the built-in model (Node, q8). A confident person name must
// not swallow the next entity just because it is tagged I-.
test('a confident name does not absorb a following organization', () => {
  const text = 'Maria Gonzalez Northwind Traders Leeds';
  const tokens = [
    tok('Maria', 'B-PER', 0.98), tok('Gonzalez', 'I-PER', 0.94), tok('North', 'I-ORG', 0.51), tok('##wind', 'I-ORG', 0.71),
    tok('Trade', 'O', 0.77), tok('##rs', 'O', 0.77), tok('Leeds', 'I-ORG', 0.51),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Maria Gonzalez', 'PERSON'], ['Northwind', 'ORGANIZATION']]);
});

test('entities never continue across a line break', () => {
  const text = 'John Smith\nAcme Corp\nLondon';
  const tokens = [
    tok('John', 'B-PER', 0.98), tok('Smith', 'I-PER', 0.97), tok('A', 'I-ORG', 0.94), tok('##c', 'I-ORG', 0.95),
    tok('##me', 'I-ORG', 0.83), tok('Corp', 'I-ORG', 0.99), tok('London', 'I-ORG', 0.96),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['John Smith', 'PERSON'], ['Acme Corp', 'ORGANIZATION'], ['London', 'ORGANIZATION']]);
});

test('the multi-word allowance is judged after greeting words are trimmed', () => {
  const tokens = [tok('Hi', 'B-PER', 0.46), tok('Team', 'I-PER', 0.46), tok(',', 'O')];
  assert.deepEqual(alignTokens('Hi Team,', tokens), []);
});

// Captured: in the browser runtime "Ask" scored just over 0.6 as its own name.
test('a command or greeting word on its own is never a name', () => {
  const text = 'Ask Hannah Becker or Tom Ruiz';
  const tokens = [
    tok('Ask', 'B-PER', 0.61), tok('Hannah', 'B-PER', 0.95), tok('Becker', 'I-PER', 0.99),
    tok('or', 'O'), tok('Tom', 'B-PER', 1.0), tok('Ruiz', 'I-PER', 0.99),
  ];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Hannah Becker', 'PERSON'], ['Tom Ruiz', 'PERSON']]);
});

test('detectWithModel shows the model truecased text but reports the original words', async () => {
  const seen = [];
  const runModel = async (chunk) => {
    seen.push(chunk);
    return chunk.split(/\s+/).map((w) => ({
      word: w, entity: w === 'Omar' ? 'B-PER' : w === 'Haddad' ? 'I-PER' : 'O', score: 0.99,
    }));
  };
  const isKnownWord = (w) => ['ask', 'to', 'call', 'me'].includes(w);
  const entities = await detectWithModel('ask omar haddad to call me', runModel, ['PERSON'], { isKnownWord });
  assert.deepEqual(seen, ['ask Omar Haddad to call me']);
  assert.deepEqual(entities, [{ text: 'omar haddad', type: 'PERSON' }]);
});

test('a name the model runs into an email address stops before the @', () => {
  const text = 'Aisha Bello aisha@unilag.example';
  const tokens = [tok('Aisha', 'B-PER'), tok('Bello', 'I-PER'), tok('aisha', 'I-PER'), tok('@', 'O')];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Aisha Bello', 'PERSON']]);
});

test('job titles, Passport and command verbs are not entities', () => {
  assert.deepEqual(pairs(alignTokens('Senior Analyst', [tok('Senior', 'B-PER'), tok('Analyst', 'O')])), []);
  assert.deepEqual(pairs(alignTokens('Passport no.', [tok('Pass', 'B-LOC'), tok('##port', 'B-LOC'), tok('no', 'O')])), []);
  assert.deepEqual(pairs(alignTokens('Compare ChatGPT', [tok('Compare', 'B-ORG'), tok('ChatGPT', 'I-ORG')])), []);
});

test('detectWithModel reads CSV rows one at a time', async () => {
  const seen = [];
  const runModel = async (chunk) => {
    seen.push(chunk);
    return [];
  };
  await detectWithModel('name,email\nWei Zhang,wei@x.example\n\nfatima ahmed,f@x.example', runModel, ['PERSON']);
  assert.deepEqual(seen, ['name,email', 'Wei Zhang,wei@x.example', 'fatima ahmed,f@x.example']);
});

test('the stoplist ignores case, so truecased acronyms are still not entities', () => {
  assert.deepEqual(pairs(alignTokens('Kyc report', [tok('Kyc', 'B-ORG'), tok('report', 'O')])), []);
});

test('CSV rows are read one at a time even with a plain line before or after them', async () => {
  const seen = [];
  const runModel = async (chunk) => {
    seen.push(chunk);
    return [];
  };
  await detectWithModel('Count the rows in this CSV:\nname,email\nWei Zhang,wei@x.example\nfatima ahmed,f@x.example\nThanks!', runModel, ['PERSON']);
  assert.deepEqual(seen, ['Count the rows in this CSV:', 'name,email', 'Wei Zhang,wei@x.example', 'fatima ahmed,f@x.example', 'Thanks!']);
});

test('prose lines that happen to contain commas are still read together', async () => {
  const seen = [];
  const runModel = async (chunk) => {
    seen.push(chunk);
    return [];
  };
  const text = 'Hi team, quick update.\nThe report is late, sorry.';
  await detectWithModel(text, runModel, ['PERSON']);
  assert.deepEqual(seen, [text]);
});
