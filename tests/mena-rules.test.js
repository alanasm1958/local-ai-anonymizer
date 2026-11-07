// Rules added for users across the Middle East and North Africa, found by the
// stress suite (tests/stress/). Each test names the leak it closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns } from '../src/core/detectors.js';
import { fitsRegionalPlan } from '../src/core/phone-plans.js';
import { detectionView } from '../src/core/normalize.js';
import { anonymize, restoreText } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const TYPES = DEFAULT_SETTINGS.patternTypes;
const found = (text) => detectPatterns(text, TYPES).map((s) => [s.type, s.value]);
const typesIn = (text) => found(text).map(([type]) => type);
const patternsOnly = { ...DEFAULT_SETTINGS, useModel: false };
const run = (text) => anonymize(text, { settings: patternsOnly, vault: createVault(), detectEntities: async () => [] });

test('regional plans accept local, international and (0) forms', () => {
  for (const n of ['03 546 390', '+961 3 546 390', '00961 3 546 390', '+961 (0) 3 546 390', '0100 123 4567',
    '+20 100 123 4567', '079 123 4567', '+974 5512 3456', '5512 3456', '+212 6 12 34 56 78', '22 345 678']) {
    assert.equal(fitsRegionalPlan(n), true, n);
  }
});

test('regional plans reject bare 8-digit runs and numbers outside any plan', () => {
  for (const n of ['50123456', '12345', '+44 20 7946 0958', '0000 000 000']) {
    assert.equal(fitsRegionalPlan(n), false, n);
  }
});

test('8-digit local numbers from Lebanon, the Gulf and Tunisia are phones', () => {
  for (const n of ['03 546 390', '5512 3456', '9123-4567', '+961-3-54-6390', '00965 6512 3456', '+968 (0) 9123 4567']) {
    assert.deepEqual(typesIn(`call ${n} today`), ['PHONE'], n);
  }
});

test('IP addresses, versions and plain counts are not phones', () => {
  assert.deepEqual(typesIn('server 10.24.7.193 is down'), ['IP_ADDRESS']);
  for (const s of ['update to version 10.24.7', 'we ordered 250 units', 'from 2019 to 2024', 'Order 50123456 shipped']) {
    assert.ok(!typesIn(s).includes('PHONE'), s);
  }
});

test('a 6-digit number after a phone word is a phone, in English or Arabic', () => {
  assert.deepEqual(found('WhatsApp 546 390'), [['PHONE', '546 390']]);
  assert.deepEqual(found('رقم الهاتف 408 891'), [['PHONE', '408 891']]);
});

test('seven-digit local numbers with one separator are phones', () => {
  assert.deepEqual(found('ring 555-1234 after lunch'), [['PHONE', '555-1234']]);
});

test('IBANs are found in lowercase', () => {
  assert.deepEqual(typesIn('pay to iq98 nbiq 8501 2345 6789 012 please'), ['IBAN']);
});

test('regional ID keywords and lowercase IDs', () => {
  assert.deepEqual(found('CIN BE467059'), [['ID_NUMBER', 'BE467059']]);
  assert.deepEqual(found('cin 09733311'), [['ID_NUMBER', '09733311']]);
  assert.deepEqual(found('iqama 2123456789'), [['ID_NUMBER', '2123456789']]);
  assert.deepEqual(found('passport no a39573324'), [['ID_NUMBER', 'a39573324']]);
  assert.deepEqual(found('case # cr-656436'), [['ID_NUMBER', 'cr-656436']]);
  assert.deepEqual(found('الرقم القومي 29001011234567'), [['ID_NUMBER', '29001011234567']]);
});

test('lowercase words with a number in them are still not IDs', () => {
  for (const s of ['reference python3', 'claim form2023a', 'staff handbook2024', 'ref: node18-alpine']) {
    assert.deepEqual(found(s), [], s);
  }
});

test('dates of birth: day-month-year with a month name, Arabic keyword, quotes', () => {
  assert.deepEqual(found('DOB 15-Jan-1978'), [['DATE_OF_BIRTH', '15-Jan-1978']]);
  assert.deepEqual(found('تاريخ الميلاد 12/04/1971'), [['DATE_OF_BIRTH', '12/04/1971']]);
  assert.deepEqual(found('born on "January 15, 1978"'), [['DATE_OF_BIRTH', 'January 15, 1978']]);
});

test('street addresses in any casing, but not prose that reads like one', () => {
  assert.deepEqual(found('221 baker street'), [['ADDRESS', '221 baker street']]);
  assert.deepEqual(found('221 BAKER STREET'), [['ADDRESS', '221 BAKER STREET']]);
  assert.deepEqual(found('42 wallaby way, sydney'), [['ADDRESS', '42 wallaby way']]);
  for (const s of ['3 kids on the road', 'we drove 2 hours down the road', '2 kids crossed the street']) {
    assert.deepEqual(found(s), [], s);
  }
});

test('detection view: plain digits, no invisible characters, offsets map back', () => {
  const original = 'call \u200f٠٧٧٠ ١٢٣ ٤٥٦٧\u200f now';
  const view = detectionView(original);
  assert.equal(view.text, 'call 0770 123 4567 now');
  const start = view.text.indexOf('0770');
  const mapped = view.toOriginal(start, start + '0770 123 4567'.length);
  assert.equal(original.slice(mapped.start, mapped.end), '٠٧٧٠ ١٢٣ ٤٥٦٧');
  assert.equal(detectionView('plain text').changed, false);
});

test('Arabic-Indic, Persian and full-width digits are hidden and restored exactly', async () => {
  for (const text of ['call ٠٧٧٠ ١٢٣ ٤٥٦٧ now', 'mobile ۰۷۷ ۷۵۰ ۰۵۴۲', 'tel ０７７０ １２３ ４５６７', 'DOB ١٥/٠١/١٩٧٨']) {
    const r = await run(text);
    assert.match(r.text, /\[(PHONE|DATE_OF_BIRTH)_1\]/, text);
    assert.equal(restoreText(r.text, r.vault).text, text);
  }
});

test('a zero-width space inside an email does not hide it from the rules', async () => {
  const text = 'write to rania.had\u200bdad@gmail.com today';
  const r = await run(text);
  assert.equal(r.text, 'write to [EMAIL_1] today');
  assert.equal(restoreText(r.text, r.vault).text, text);
});

test('two phone numbers joined by a slash or dash are both found (review finding)', () => {
  assert.deepEqual(found('07701234567/07801234567'), [['PHONE', '07701234567'], ['PHONE', '07801234567']]);
  assert.deepEqual(found('0770 123 4567/0780 123 4567'), [['PHONE', '0770 123 4567'], ['PHONE', '0780 123 4567']]);
  assert.deepEqual(found('Phones: 07701234567-07801234567'), [['PHONE', '07701234567'], ['PHONE', '07801234567']]);
  assert.deepEqual(typesIn('+971 50 123 4567/8'), ['PHONE']);
  assert.deepEqual(typesIn('0501234567/8'), ['PHONE']);
});

test('year ranges and round amounts are not phones (review finding)', () => {
  for (const s of ['Strategy 2019-2024 overview', 'Budget for 2023-2024 fiscal year', 'from 1990-2000', 'Range 2000-3000',
    'Prices 5000 6000', 'Academic year 2024 2025', 'We hired 1200 1500 people', 'The year 1999 2000 2001 2002']) {
    assert.ok(!typesIn(s).includes('PHONE'), s);
  }
  assert.deepEqual(typesIn('call 5512 3456'), ['PHONE']);
});

test('a name first pasted with an invisible character is found again later (review finding)', async () => {
  const settings = { ...DEFAULT_SETTINGS };
  const first = await anonymize('Om​ar Farouk wrote', {
    settings, vault: createVault(), detectEntities: async () => [{ text: 'Omar Farouk', type: 'PERSON' }],
  });
  const second = await anonymize('Omar Farouk and Omar and Farouk again', { settings, vault: first.vault, detectEntities: async () => [] });
  // Nothing leaks. (The repeat may get a new number: the vault keys values exactly as pasted.)
  assert.match(second.text, /^\[PERSON_\d\] and \[PERSON_\d\] and \[PERSON_\d\] again$/);
});
