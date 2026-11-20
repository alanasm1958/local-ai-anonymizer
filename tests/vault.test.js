import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, assignPlaceholder, assignPlaceholders, lookupPlaceholder, lookupForSite, isRevealable, vaultSize, isVault } from '../src/core/vault.js';

test('assigns numbered placeholders per type', () => {
  const v0 = createVault();
  const { vault: v1, placeholder: p1 } = assignPlaceholder(v0, 'PERSON', 'Jane Doe');
  const { vault: v2, placeholder: p2 } = assignPlaceholder(v1, 'PERSON', 'John Roe');
  const { vault: v3, placeholder: p3 } = assignPlaceholder(v2, 'EMAIL', 'j@x.io');
  assert.equal(p1, '[PERSON_1]');
  assert.equal(p2, '[PERSON_2]');
  assert.equal(p3, '[EMAIL_1]');
  assert.equal(vaultSize(v3), 3);
});

test('reuses the placeholder for a repeated value', () => {
  const { vault: v1, placeholder: a } = assignPlaceholder(createVault(), 'PERSON', 'Jane Doe');
  const { vault: v2, placeholder: b } = assignPlaceholder(v1, 'PERSON', 'Jane Doe');
  assert.equal(a, b);
  assert.equal(v2, v1, 'no change means the same vault object comes back');
});

test('matching is case-insensitive for names and emails', () => {
  const { vault: v1, placeholder: a } = assignPlaceholder(createVault(), 'EMAIL', 'Jane@X.io');
  const { placeholder: b } = assignPlaceholder(v1, 'EMAIL', 'jane@x.io');
  assert.equal(a, b);
});

test('never mutates the input vault', () => {
  const v0 = createVault();
  const frozen = JSON.stringify(v0);
  assignPlaceholder(v0, 'PERSON', 'Jane');
  assert.equal(JSON.stringify(v0), frozen);
});

test('lookupPlaceholder returns the first original seen', () => {
  const { vault } = assignPlaceholder(createVault(), 'PERSON', 'Jane Doe');
  assert.equal(lookupPlaceholder(vault, '[PERSON_1]'), 'Jane Doe');
  assert.equal(lookupPlaceholder(vault, '[PERSON_9]'), undefined);
});

test('isVault validates shape loaded from storage', () => {
  assert.equal(isVault(createVault()), true);
  assert.equal(isVault(null), false);
  assert.equal(isVault({ byPlaceholder: {} }), false);
});

test('createVault can continue numbering from a counter floor', () => {
  const { placeholder } = assignPlaceholder(createVault({ PERSON: 4 }), 'PERSON', 'Jane');
  assert.equal(placeholder, '[PERSON_5]');
});

test('assignPlaceholders handles a batch with one copy', () => {
  const { vault, placeholders } = assignPlaceholders(createVault(), [
    { type: 'PERSON', value: 'A' }, { type: 'PERSON', value: 'B' }, { type: 'PERSON', value: 'a' },
  ]);
  assert.deepEqual(placeholders, ['[PERSON_1]', '[PERSON_2]', '[PERSON_1]']);
  assert.equal(vaultSize(vault), 2);
});

test('assignPlaceholders records the site each value came from', () => {
  const { vault: v1 } = assignPlaceholders(createVault(), [{ type: 'PERSON', value: 'Ana' }], { site: 'chatgpt.com' });
  const { vault: v2 } = assignPlaceholders(v1, [{ type: 'PERSON', value: 'Ana' }], { site: 'claude.ai' });
  assert.equal(lookupForSite(v2, '[PERSON_1]', 'chatgpt.com'), 'Ana');
  assert.equal(lookupForSite(v2, '[PERSON_1]', 'claude.ai'), 'Ana');
  assert.equal(lookupForSite(v1, '[PERSON_1]', 'claude.ai'), undefined);
});

test('values added from the extension itself are visible on any site', () => {
  const { vault } = assignPlaceholders(createVault(), [{ type: 'PERSON', value: 'Ana' }]);
  assert.equal(lookupForSite(vault, '[PERSON_1]', 'gemini.google.com'), 'Ana');
});

test('lookupForSite tolerates vaults saved before site tracking', () => {
  const legacy = { byPlaceholder: { '[PERSON_1]': 'Ana' }, byKey: {}, counters: { PERSON: 1 } };
  assert.equal(isVault(legacy), true);
  assert.equal(lookupForSite(legacy, '[PERSON_1]', 'chatgpt.com'), undefined);
});

test('isRevealable allows names and contact details but not secrets', () => {
  for (const p of ['[PERSON_1]', '[ORGANIZATION_2]', '[LOCATION_1]', '[EMAIL_1]', '[PHONE_3]', '[ADDRESS_1]']) assert.equal(isRevealable(p), true, p);
  for (const p of ['[CREDIT_CARD_1]', '[SSN_1]', '[IBAN_1]', '[API_KEY_1]', '[ID_NUMBER_1]', '[DATE_OF_BIRTH_1]', '[IP_ADDRESS_1]']) assert.equal(isRevealable(p), false, p);
});

// Copying a reply fills in every type (cards and IDs too: they go to the
// user's own clipboard, never into the page), but only values pasted on
// the site the copy happens on.
test('originalsForCopy returns this site\'s values of every type, nothing else', async () => {
  const { originalsForCopy } = await import('../src/core/vault.js');
  const { vault: v1 } = assignPlaceholders(createVault(), [
    { type: 'PERSON', value: 'Ana' }, { type: 'CREDIT_CARD', value: '4111 1111 1111 1111' },
  ], { site: 'chatgpt.com' });
  const { vault } = assignPlaceholders(v1, [{ type: 'EMAIL', value: 'b@x.io' }], { site: 'claude.ai' });
  const asked = ['[PERSON_1]', '[CREDIT_CARD_1]', '[EMAIL_1]', '[PERSON_9]', 'not a placeholder', 42];
  assert.deepEqual(originalsForCopy(vault, asked, 'chatgpt.com'), { '[PERSON_1]': 'Ana', '[CREDIT_CARD_1]': '4111 1111 1111 1111' });
  assert.deepEqual(originalsForCopy(vault, asked, 'claude.ai'), { '[EMAIL_1]': 'b@x.io' });
  assert.deepEqual(originalsForCopy(vault, 'nope', 'chatgpt.com'), {});
});

test('originalsForCopy caps how many placeholders one copy can ask for', async () => {
  const { originalsForCopy, MAX_COPY_LOOKUP } = await import('../src/core/vault.js');
  const items = Array.from({ length: MAX_COPY_LOOKUP + 5 }, (_, i) => ({ type: 'PERSON', value: `P${i}` }));
  const { vault } = assignPlaceholders(createVault(), items, { site: 'chatgpt.com' });
  const asked = Object.keys(vault.byPlaceholder);
  assert.equal(Object.keys(originalsForCopy(vault, asked, 'chatgpt.com')).length, MAX_COPY_LOOKUP);
});
