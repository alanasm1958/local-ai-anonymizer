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
