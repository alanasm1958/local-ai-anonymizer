import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpans } from '../src/core/spans.js';
import { applySpans, restoreText, anonymize } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const span = (start, end, type, source = 'pattern', value = 'x') => ({ start, end, type, source, value });

test('resolveSpans drops overlaps, preferring pattern then longer spans', () => {
  const resolved = resolveSpans([
    span(0, 10, 'PERSON', 'model'),
    span(2, 6, 'EMAIL', 'pattern'),
    span(20, 30, 'PERSON', 'model'),
    span(20, 25, 'ORGANIZATION', 'model'),
    span(40, 45, 'PHONE'),
    span(40, 45, 'CREDIT_CARD'),
  ]);
  assert.deepEqual(resolved.map((s) => [s.start, s.type]), [[2, 'EMAIL'], [20, 'PERSON'], [40, 'CREDIT_CARD']]);
});

test('applySpans replaces text and records replacements', () => {
  const text = 'Hi Jane, mail jane@x.io';
  const spans = [
    { start: 3, end: 7, type: 'PERSON', value: 'Jane', source: 'model' },
    { start: 14, end: 23, type: 'EMAIL', value: 'jane@x.io', source: 'pattern' },
  ];
  const result = applySpans(text, spans, createVault());
  assert.equal(result.text, 'Hi [PERSON_1], mail [EMAIL_1]');
  assert.deepEqual(result.replacements.map((r) => r.placeholder), ['[PERSON_1]', '[EMAIL_1]']);
});

test('restoreText swaps known placeholders back and leaves unknown ones', () => {
  const { vault } = applySpans('Jane', [{ start: 0, end: 4, type: 'PERSON', value: 'Jane', source: 'model' }], createVault());
  const restored = restoreText('Dear [PERSON_1], see [PERSON_7].', vault);
  assert.equal(restored.text, 'Dear Jane, see [PERSON_7].');
  assert.equal(restored.restoredCount, 1);
});

test('anonymize combines pattern and model detection', async () => {
  const text = 'Jane Doe from Acme Corp (jane@acme.com) called Jane Doe again.';
  const detectEntities = async () => [
    { text: 'Jane Doe', type: 'PERSON' },
    { text: 'Acme Corp', type: 'ORGANIZATION' },
  ];
  const result = await anonymize(text, { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities });
  assert.equal(result.text, '[PERSON_1] from [ORGANIZATION_1] ([EMAIL_1]) called [PERSON_1] again.');
  assert.deepEqual(result.warnings, []);
  assert.equal(restoreText(result.text, result.vault).text, text);
});

test('anonymize keeps placeholders stable across calls via the vault', async () => {
  const detectEntities = async (t) => (t.includes('Jane') ? [{ text: 'Jane', type: 'PERSON' }] : []);
  const first = await anonymize('Jane', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities });
  const second = await anonymize('Ask Jane', { settings: DEFAULT_SETTINGS, vault: first.vault, detectEntities });
  assert.equal(second.text, 'Ask [PERSON_1]');
});

test('anonymize falls back to patterns when the model fails', async () => {
  const detectEntities = async () => { throw new Error('connection refused'); };
  const result = await anonymize('Jane at jane@x.io', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities });
  assert.equal(result.text, 'Jane at [EMAIL_1]');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /connection refused/);
});

test('anonymize rethrows model errors when set to cancel', async () => {
  const settings = { ...DEFAULT_SETTINGS, onModelError: 'cancel' };
  const detectEntities = async () => { throw new Error('boom'); };
  await assert.rejects(anonymize('x', { settings, vault: createVault(), detectEntities }), /boom/);
});

test('anonymize skips the model when disabled', async () => {
  const settings = { ...DEFAULT_SETTINGS, useModel: false };
  let called = false;
  const detectEntities = async () => { called = true; return []; };
  const result = await anonymize('Jane', { settings, vault: createVault(), detectEntities });
  assert.equal(called, false);
  assert.equal(result.text, 'Jane');
});

test('anonymize ignores model entities of disabled types and existing placeholders', async () => {
  const settings = { ...DEFAULT_SETTINGS, modelTypes: { ...DEFAULT_SETTINGS.modelTypes, ORGANIZATION: false } };
  const detectEntities = async () => [
    { text: 'Acme', type: 'ORGANIZATION' },
    { text: '[PERSON_1]', type: 'PERSON' },
  ];
  const result = await anonymize('[PERSON_1] works at Acme', { settings, vault: createVault(), detectEntities });
  assert.equal(result.text, '[PERSON_1] works at Acme');
});

test('anonymize handles empty input', async () => {
  const result = await anonymize('', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: async () => [] });
  assert.equal(result.text, '');
  assert.deepEqual(result.replacements, []);
});

test('anonymize scales linearly on a 10k-email paste', async () => {
  const text = Array.from({ length: 10000 }, (_, i) => `user${i}@example.com`).join('\n');
  const settings = { ...DEFAULT_SETTINGS, useModel: false };
  const started = Date.now();
  const result = await anonymize(text, { settings, vault: createVault(), detectEntities: async () => [] });
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  assert.match(result.text, /\[EMAIL_10000\]$/);
});

test('restoreText reports placeholders the vault does not know', () => {
  const restored = restoreText('[PERSON_3] and [EMAIL_1]', createVault());
  assert.equal(restored.unknownCount, 2);
});

test('anonymize records the site the text was pasted into', async () => {
  const detectEntities = async () => [{ text: 'Jane', type: 'PERSON' }];
  const result = await anonymize('Jane', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities, site: 'claude.ai' });
  assert.deepEqual(result.vault.sites, { '[PERSON_1]': ['claude.ai'] });
});

const onlyFullName = (name) => async (t) => (t.includes(name) ? [{ text: name, type: 'PERSON' }] : []);

test('first or last name alone maps to the same placeholder as the full name', async () => {
  const text = 'Maria Gonzalez called. Later Maria said Gonzalez agreed.';
  const result = await anonymize(text, { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: onlyFullName('Maria Gonzalez') });
  assert.equal(result.text, '[PERSON_1] called. Later [PERSON_1] said [PERSON_1] agreed.');
  assert.equal(restoreText(result.text, result.vault).text, 'Maria Gonzalez called. Later Maria Gonzalez said Maria Gonzalez agreed.');
});

test('names known from earlier pastes are caught on their own', async () => {
  const first = await anonymize('Maria Gonzalez', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: onlyFullName('Maria Gonzalez') });
  const second = await anonymize('Ask Maria about it', { settings: DEFAULT_SETTINGS, vault: first.vault, detectEntities: async () => [] });
  assert.equal(second.text, 'Ask [PERSON_1] about it');
});

test('name parts that are ordinary words or too short are left alone', async () => {
  const will = await anonymize('Will Smith is here. Will you call?', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: onlyFullName('Will Smith') });
  assert.equal(will.text, '[PERSON_1] is here. Will you call?');
  const li = await anonymize('Li Na wrote. Na means nothing here.', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: onlyFullName('Li Na') });
  assert.equal(li.text, '[PERSON_1] wrote. Na means nothing here.');
});

test('name parts are not matched inside other words or in lowercase', async () => {
  const result = await anonymize('Mark Rivera met Markus. Rivera said mark the date.', {
    settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: onlyFullName('Mark Rivera'),
  });
  assert.equal(result.text, '[PERSON_1] met Markus. [PERSON_1] said mark the date.');
});

test('values anonymized earlier in the session are caught even if the model misses them', async () => {
  const detectFirst = async () => [{ text: 'Northwind Traders', type: 'ORGANIZATION' }, { text: 'Leeds', type: 'LOCATION' }];
  const first = await anonymize('Northwind Traders in Leeds', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: detectFirst });
  const second = await anonymize('Visit Northwind Traders in Leeds again', { settings: DEFAULT_SETTINGS, vault: first.vault, detectEntities: async () => [] });
  assert.equal(second.text, 'Visit [ORGANIZATION_1] in [LOCATION_1] again');
});

test('known values of disabled types are not matched', async () => {
  const first = await anonymize('Leeds', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: async () => [{ text: 'Leeds', type: 'LOCATION' }] });
  const settings = { ...DEFAULT_SETTINGS, modelTypes: { ...DEFAULT_SETTINGS.modelTypes, LOCATION: false } };
  const second = await anonymize('Back to Leeds', { settings, vault: first.vault, detectEntities: async () => [] });
  assert.equal(second.text, 'Back to Leeds');
});

const detectList = (list) => async () => list;

test('a name part loses a tie to what the model says the word is', async () => {
  const result = await anonymize('Paris Hilton visited Paris, France.', {
    settings: DEFAULT_SETTINGS, vault: createVault(),
    detectEntities: detectList([{ text: 'Paris Hilton', type: 'PERSON' }, { text: 'Paris', type: 'LOCATION' }, { text: 'France', type: 'LOCATION' }]),
  });
  assert.equal(result.text, '[PERSON_1] visited [LOCATION_1], [LOCATION_2].');
});

test('a lone first name the model tags itself still joins the known full name', async () => {
  const result = await anonymize('Maria Gonzalez called. Maria said hi.', {
    settings: DEFAULT_SETTINGS, vault: createVault(),
    detectEntities: detectList([{ text: 'Maria Gonzalez', type: 'PERSON' }, { text: 'Maria', type: 'PERSON' }]),
  });
  assert.equal(result.text, '[PERSON_1] called. [PERSON_1] said hi.');
});

test('name parts are not matched inside hyphenated or longer names', async () => {
  const result = await anonymize('Ana Gonzalez met Luis Gonzalez-Lopez and Gonzalez\'s team.', {
    settings: DEFAULT_SETTINGS, vault: createVault(),
    detectEntities: detectList([{ text: 'Ana Gonzalez', type: 'PERSON' }]),
  });
  assert.equal(result.text, '[PERSON_1] met Luis Gonzalez-Lopez and Gonzalez\'s team.');
});

test('the same person written with different spacing is not treated as two people', async () => {
  const first = await anonymize('Maria  Gonzalez', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: detectList([{ text: 'Maria  Gonzalez', type: 'PERSON' }]) });
  const second = await anonymize('Maria Gonzalez and Maria', { settings: DEFAULT_SETTINGS, vault: first.vault, detectEntities: detectList([{ text: 'Maria Gonzalez', type: 'PERSON' }]) });
  assert.equal(second.text, '[PERSON_1] and [PERSON_1]');
});

test('short or stoplisted vault values are not matched in later pastes', async () => {
  const first = await anonymize('IT and US', {
    settings: DEFAULT_SETTINGS, vault: createVault(),
    detectEntities: detectList([{ text: 'IT', type: 'ORGANIZATION' }, { text: 'US', type: 'LOCATION' }]),
  });
  const second = await anonymize('Ask IT about the US office', { settings: DEFAULT_SETTINGS, vault: first.vault, detectEntities: detectList([]) });
  assert.equal(second.text, 'Ask IT about the US office');
});

test('known values are only matched when model detection is on', async () => {
  const first = await anonymize('Northwind Traders', { settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: detectList([{ text: 'Northwind Traders', type: 'ORGANIZATION' }]) });
  const off = { ...DEFAULT_SETTINGS, useModel: false };
  const second = await anonymize('Northwind Traders again', { settings: off, vault: first.vault, detectEntities: detectList([]) });
  assert.equal(second.text, 'Northwind Traders again');
});
