import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, assignPlaceholder, assignPlaceholders, lookupPlaceholder, vaultSize, isVault } from '../src/core/vault.js';

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
