import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReplacements, formatBreakdown, sessionTally, recordRun, emptyStats } from '../src/core/report.js';
import { createVault, assignPlaceholders } from '../src/core/vault.js';

const r = (placeholder, type) => ({ placeholder, type, original: 'x', source: 'pattern' });

test('summarizeReplacements counts distinct items and mentions per type', () => {
  const summary = summarizeReplacements([
    r('[PERSON_1]', 'PERSON'), r('[PERSON_1]', 'PERSON'), r('[PERSON_2]', 'PERSON'),
    r('[EMAIL_1]', 'EMAIL'), r('[PHONE_1]', 'PHONE'),
  ]);
  assert.equal(summary.items, 4);
  assert.equal(summary.mentions, 5);
  assert.deepEqual(summary.byType, [
    { type: 'PERSON', items: 2, mentions: 3 },
    { type: 'EMAIL', items: 1, mentions: 1 },
    { type: 'PHONE', items: 1, mentions: 1 },
  ]);
});

test('formatBreakdown reads naturally, with plurals and mention counts when they differ', () => {
  const summary = summarizeReplacements([
    r('[PERSON_1]', 'PERSON'), r('[PERSON_1]', 'PERSON'), r('[PERSON_2]', 'PERSON'),
    r('[EMAIL_1]', 'EMAIL'), r('[ADDRESS_1]', 'ADDRESS'), r('[ADDRESS_2]', 'ADDRESS'),
    r('[CREDIT_CARD_1]', 'CREDIT_CARD'),
  ]);
  assert.equal(formatBreakdown(summary.byType), '2 names (3 mentions), 2 addresses, 1 email, 1 card number');
});

test('formatBreakdown covers every type and is empty for nothing', () => {
  const types = ['PERSON', 'ORGANIZATION', 'LOCATION', 'EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IP_ADDRESS',
    'IBAN', 'API_KEY', 'URL', 'DATE_OF_BIRTH', 'ID_NUMBER', 'ADDRESS', 'POSTCODE'];
  const text = formatBreakdown(types.map((type) => ({ type, items: 2, mentions: 2 })));
  assert.equal(text.includes('undefined'), false, text);
  assert.equal(text.split(', ').length, types.length);
  assert.equal(formatBreakdown([]), '');
});

test('summary of no replacements is zero', () => {
  assert.deepEqual(summarizeReplacements([]), { items: 0, mentions: 0, byType: [] });
});

test('recordRun accumulates runs and mentions without mutating', () => {
  const s0 = emptyStats();
  const s1 = recordRun(s0, summarizeReplacements([r('[PERSON_1]', 'PERSON'), r('[PERSON_1]', 'PERSON')]));
  const s2 = recordRun(s1, summarizeReplacements([r('[EMAIL_1]', 'EMAIL')]));
  assert.deepEqual(s0, emptyStats());
  assert.equal(s2.runs, 2);
  assert.deepEqual(s2.mentionsByType, { PERSON: 2, EMAIL: 1 });
});

test('recordRun ignores runs that replaced nothing', () => {
  assert.deepEqual(recordRun(emptyStats(), summarizeReplacements([])), emptyStats());
});

test('sessionTally groups vault items by type and by site', () => {
  const { vault: v1 } = assignPlaceholders(createVault(), [
    { type: 'PERSON', value: 'Ana' }, { type: 'PERSON', value: 'Bo' }, { type: 'EMAIL', value: 'a@b.io' },
  ], { site: 'chatgpt.com' });
  const { vault: v2 } = assignPlaceholders(v1, [{ type: 'PERSON', value: 'Ana' }, { type: 'PHONE', value: '555 0101 0101' }], { site: 'claude.ai' });
  const { vault: v3 } = assignPlaceholders(v2, [{ type: 'ADDRESS', value: '1 Elm Street' }]);
  const stats = { runs: 3, mentionsByType: { PERSON: 4, EMAIL: 1, PHONE: 1, ADDRESS: 1 } };

  const tally = sessionTally(v3, stats);
  assert.equal(tally.items, 5);
  assert.equal(tally.runs, 3);
  assert.equal(tally.mentions, 7);
  assert.deepEqual(tally.byType, [
    { type: 'PERSON', items: 2, mentions: 4 },
    { type: 'EMAIL', items: 1, mentions: 1 },
    { type: 'PHONE', items: 1, mentions: 1 },
    { type: 'ADDRESS', items: 1, mentions: 1 },
  ]);
  assert.deepEqual(tally.bySite, [
    { site: 'chatgpt.com', items: 3 },
    { site: 'claude.ai', items: 2 },
    { site: 'Popup', items: 1 },
  ]);
});

test('sessionTally handles an empty vault and legacy vaults without sites', () => {
  assert.deepEqual(sessionTally(createVault(), emptyStats()), { items: 0, runs: 0, mentions: 0, byType: [], bySite: [] });
  const legacy = { byPlaceholder: { '[PERSON_1]': 'Ana' }, byKey: {}, counters: { PERSON: 1 } };
  assert.equal(sessionTally(legacy, emptyStats()).items, 1);
  assert.deepEqual(sessionTally(legacy, emptyStats()).bySite, []);
});
