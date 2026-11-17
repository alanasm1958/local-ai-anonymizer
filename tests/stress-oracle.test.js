import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeCase, normalize, wordTokens } from './stress/oracle.js';
import { generateCases } from './stress/generate.js';

const kase = (secrets, extra = {}) => ({ secrets, keep: [], background: '', expected: 'must_catch', ...extra });

test('a surname left next to a placeholder is a leak, whatever its case', () => {
  const r = judgeCase(kase([{ kind: 'words', value: 'Rania Haddad' }]), 'Call [PERSON_1] HADDAD today');
  assert.deepEqual(r.leaked, ['Haddad']);
  assert.equal(r.verdict, 'fail');
});

test('name particles alone are not leaks', () => {
  assert.deepEqual(wordTokens('Sonia Ben Salah'), ['Sonia', 'Salah']);
  assert.equal(judgeCase(kase([{ kind: 'words', value: 'Yousef Abu Hammad' }]), 'from [PERSON_1] abu').verdict, 'pass');
});

test('a word inside another word is not a leak', () => {
  assert.equal(judgeCase(kase([{ kind: 'words', value: 'Amal Fawzi' }]), 'the [PERSON_1] normal amalgam').verdict, 'pass');
});

test('four digits of a phone number left behind is a leak, separators ignored', () => {
  const r = judgeCase(kase([{ kind: 'digits', value: '0770 123 4567' }]), 'call 0770 [PHONE_1] 45-67');
  assert.equal(r.verdict, 'fail');
});

test('a phone hidden whole passes, even with a country code left before it', () => {
  assert.equal(judgeCase(kase([{ kind: 'digits', value: '+964 770 123 4567' }]), 'call +964 [PHONE_1]').verdict, 'pass');
});

test('digits that the context itself contains are not counted', () => {
  const r = judgeCase(kase([{ kind: 'digits', value: '2017 5555' }], { background: 'row 2017 ' }), 'row 2017 [PHONE_1]');
  assert.equal(r.verdict, 'pass');
});

test('Arabic-Indic and full-width digits are read as digits', () => {
  assert.equal(normalize('٠٧٥٠ ۱۲۳ ４５'), '0750 123 45');
  const r = judgeCase(kase([{ kind: 'digits', value: '٠٧٥٠١٢٣٤٥٦٧' }]), 'رقم ٠٧٥٠١٢٣٤٥٦٧');
  assert.equal(r.verdict, 'fail');
});

test('zero-width characters do not hide a leaked name', () => {
  const r = judgeCase(kase([{ kind: 'words', value: 'Karim Nassar' }]), 'Kar\u200bim Nassar');
  assert.deepEqual(r.leaked, ['Karim', 'Nassar']);
});

test('a lost keep phrase is over-redaction', () => {
  const r = judgeCase({ secrets: [], keep: ['IQD 250,000'], background: '', expected: 'must_keep' }, 'fee [PHONE_1]');
  assert.equal(r.verdict, 'fail');
  assert.deepEqual(r.overRedacted, ['IQD 250,000']);
});

test('known gaps report as gaps, and as fixed once they pass', () => {
  const gap = kase([{ kind: 'words', value: 'ليلى منصور' }], { expected: 'known_gap' });
  assert.equal(judgeCase(gap, 'ليلى منصور').verdict, 'known_gap');
  assert.equal(judgeCase(gap, '[PERSON_1]').verdict, 'gap_fixed');
});

test('the generator is seeded, large, and every case is well formed', () => {
  const a = generateCases();
  const b = generateCases();
  assert.deepEqual(a, b);
  assert.ok(a.length >= 3000, `only ${a.length} cases`);
  assert.equal(new Set(a.map((c) => c.id)).size, a.length);
  for (const c of a) {
    assert.ok(['must_catch', 'must_keep', 'known_gap', 'may_hide'].includes(c.expected), c.id);
    if (c.expected !== 'must_keep') assert.ok(c.secrets.length > 0, `${c.id} has nothing to check`);
    for (const k of c.keep) assert.ok(c.text.includes(k), `${c.id} keep "${k}" is not in its text`);
  }
});
