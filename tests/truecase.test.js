import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truecase, vocabularyLookup } from '../src/core/truecase.js';

const KNOWN = new Set(['my', 'name', 'is', 'and', 'the', 'will', 'may', 'meeting', 'to', 'email', 'about', 'reply', 'please', 'send', 'forms']);
const isKnown = (word) => KNOWN.has(word);

test('capitalizes lowercase words the vocabulary does not know', () => {
  assert.equal(truecase('my name is ali hassan', isKnown), 'my name is Ali Hassan');
});

test('leaves known words alone, including words that are also names', () => {
  assert.equal(truecase('the meeting will may', isKnown), 'the meeting will may');
});

test('never changes the length, so offsets still line up', () => {
  const text = 'email omar about the café in erbil, ok? 🙂 straße';
  assert.equal(truecase(text, isKnown).length, text.length);
});

test('leaves words that are already capitalized or mixed case alone', () => {
  assert.equal(truecase('Sarah McDonald iPhone', isKnown), 'Sarah McDonald iPhone');
});

test('leaves code-like tokens alone', () => {
  const code = 'user.name foo_bar $scope `cmd` path/to/file x=val fn() a@b.io #tag';
  assert.equal(truecase(code, isKnown), code);
});

test('handles sentence punctuation around a name', () => {
  assert.equal(truecase('reply to omar? (ask sarah), "john".', isKnown), 'reply to Omar? (Ask Sarah), "John".');
});

test('leaves chat shorthand alone', () => {
  assert.equal(truecase('thx, pls ask omar btw lol', isKnown), 'thx, pls Ask Omar btw lol');
});

test('skips one-letter words', () => {
  assert.equal(truecase('i met x', isKnown), 'i Met x');
});

test('vocabularyLookup accepts a Map or a plain object', () => {
  assert.equal(vocabularyLookup(new Map([['will', 1]]))('will'), true);
  assert.equal(vocabularyLookup({ will: 1 })('will'), true);
  assert.equal(vocabularyLookup({ will: 1 })('omar'), false);
  assert.equal(vocabularyLookup({ will: 1 })('constructor'), false);
});

test('a line typed in capitals is lowered, then rare words get their capital back', () => {
  assert.equal(truecase('PLEASE EMAIL LAYLA MANSOUR', isKnown), 'please email Layla Mansour');
  assert.equal(truecase('Notes\nMY NAME IS OMAR', isKnown), 'Notes\nmy name is Omar');
});

test('short capitals and mixed-case lines are not treated as shouting', () => {
  assert.equal(truecase('Send the KYC and AML forms', isKnown), 'Send the KYC and AML forms');
  assert.equal(truecase('NASA HQ', isKnown), 'NASA HQ');
});

test('words wrapped in markdown underscores are still prose', () => {
  assert.equal(truecase('_robert kim_ and user_name and __init__', isKnown), '_Robert Kim_ and user_name and __init__');
});

test('a name in capitals inside a table cell or after a comma is lowered too', () => {
  assert.equal(truecase('| OMAR FAROUK | omar@x.example |', isKnown), '| Omar Farouk | omar@x.example |');
  assert.equal(truecase('Contact: LAYLA MANSOUR, layla@x.example', isKnown), 'Contact: Layla Mansour, layla@x.example');
});

test('one capitalized word in a cell is left alone (acronyms, headers)', () => {
  assert.equal(truecase('| CEO | KYC | omar@x.example |', isKnown), '| CEO | KYC | omar@x.example |');
});
