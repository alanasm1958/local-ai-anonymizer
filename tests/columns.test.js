// Table columns whose header names IDs or phones (src/core/columns.js).
// Found live: the second row's CIN in a CSV with a "cin" column was sent as typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnSpans, columnPlaces } from '../src/core/columns.js';
import { detectPatterns } from '../src/core/detectors.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const TYPES = DEFAULT_SETTINGS.patternTypes;
const values = (text) => columnSpans(text, TYPES).map((s) => [s.type, s.value]);

test('every row under an ID header is an ID, in CSV, TSV and markdown', () => {
  assert.deepEqual(values('name,city,cin\nSalma Bennani,Rabat,BK123456\nOmar Idrissi,Fes,AB654321'),
    [['ID_NUMBER', 'BK123456'], ['ID_NUMBER', 'AB654321']]);
  assert.deepEqual(values('name\tpassport\nRania\tN123456'), [['ID_NUMBER', 'N123456']]);
  assert.deepEqual(values('| Name | Civil ID |\n|---|---|\n| Noura | 290010112345 |'), [['ID_NUMBER', '290010112345']]);
});

test('phone headers in English and Arabic', () => {
  assert.deepEqual(values('| Name | Mobile |\n|---|---|\n| Rania | 5512 3456 |'), [['PHONE', '5512 3456']]);
  assert.deepEqual(values('الاسم,رقم الهاتف\nRania,546 390'), [['PHONE', '546 390']]);
});

test('cells without a digit, other columns and plain prose are left alone', () => {
  assert.deepEqual(values('name,cin\nSalma,n/a\nOmar,'), []);
  assert.deepEqual(values('name,city,score\nSalma,Rabat,1234'), []);
  assert.deepEqual(values('My passport, sadly, expired in 2020.'), []);
});

test('a row with a different number of cells ends the table', () => {
  assert.deepEqual(values('name,cin\nSalma,BK123456\nnotes: call back 4567, maybe, later'), [['ID_NUMBER', 'BK123456']]);
});

test('the column rule is part of detectPatterns and follows the type switches', () => {
  const text = 'name,cin\nSalma,BK123456\nOmar,AB654321';
  assert.equal(detectPatterns(text, TYPES).filter((s) => s.type === 'ID_NUMBER').length, 2);
  assert.deepEqual(columnSpans(text, { ...TYPES, ID_NUMBER: false }), []);
});

test('cells under a place header are listed as places (found live: "Rabat" hidden as a person)', () => {
  const places = (text) => [...columnPlaces(text)].sort();
  assert.deepEqual(places('name,CIN,city\nYoussef Amrani,BK123456,Rabat\nSalma Bennani,AB654321,Fes'), ['fes', 'rabat']);
  assert.deepEqual(places('| Name | Country |\n|---|---|\n| Noura | Kuwait |'), ['kuwait']);
  assert.deepEqual(places('الاسم,المدينة\nRania,Erbil'), ['erbil']);
  assert.deepEqual(places('name,city\nSalma,123\nOmar,n/a\nAli,Remote'), []);
  assert.deepEqual(places('The city, as usual, was busy.'), []);
});
