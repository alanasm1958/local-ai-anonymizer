// Name completion (src/core/name-parts.js via alignTokens) and the truecasing
// added for regional names. Token scores are the ones the real model gave
// for these texts during the 2026-11-08 stress run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignTokens } from '../src/core/ner.js';
import { truecase } from '../src/core/truecase.js';

const tok = (word, entity, score = 0.9) => ({ word, entity, score });
const pairs = (list) => list.map((e) => [e.text, e.type]);
// Vocabulary stand-in: everyday words and acronyms, no regional names.
const VOCAB = new Set(['the', 'see', 'was', 'listed', 'twice', 'in', 'section', 'two', 'contact', 'Contact', 'please',
  'follow', 'up', 'on', 'our', 'partner', 'valley', 'trading', 'co', 'excel', 'Excel', 'formulas', 'Fatima', 'NASA',
  'ESA', 'owner', 'email', 'about', 'it', 'Monday', 'monday', 'my', 'name', 'is', 'to', 'and', 'from', 'support', 'today']);
const isKnownWord = (w) => VOCAB.has(w);
const align = (text, tokens) => pairs(alignTokens(text, tokens, { isKnownWord }));

test('a MISC group of unknown capitalized words is a person', () => {
  const text = 'Hiba Zaqout was listed';
  const tokens = [tok('Hi', 'B-MISC', 0.42), tok('##ba', 'B-MISC', 0.39), tok('Z', 'I-MISC', 0.6), tok('##aq', 'I-MISC', 0.5),
    tok('##out', 'I-MISC', 0.43), tok('was', 'O'), tok('listed', 'O')];
  assert.deepEqual(align(text, tokens), [['Hiba Zaqout', 'PERSON']]);
});

test('MISC with a stoplisted or known word stays out ("Excel Formulas")', () => {
  const text = 'writing Excel Formulas';
  const tokens = [tok('writing', 'O'), tok('Excel', 'B-MISC', 0.94), tok('Formula', 'I-MISC', 0.92), tok('##s', 'I-MISC', 0.83)];
  assert.deepEqual(align(text, tokens), []);
});

test('one MISC word alone is never a person ("EGP", "Brochures")', () => {
  assert.deepEqual(align('came to EGP', [tok('came', 'O'), tok('to', 'O'), tok('EGP', 'B-MISC', 0.8)]), []);
  assert.deepEqual(align('1,200 Brochures', [tok('1', 'O'), tok(',', 'O'), tok('200', 'O'), tok('Brochures', 'B-MISC', 0.8)]), []);
});

test('a surname next to a found first name joins it', () => {
  const text = 'see Lina Qasem today';
  const tokens = [tok('see', 'O'), tok('Lina', 'B-PER', 0.95), tok('Qasem', 'O', 0.6), tok('today', 'O')];
  assert.deepEqual(align(text, tokens), [['Lina Qasem', 'PERSON']]);
});

test('a first name the vocabulary only knows capitalized joins the surname', () => {
  const text = 'Contact Fatima Ouazzani';
  const tokens = [tok('Contact', 'O'), tok('Fatima', 'O', 0.7), tok('O', 'B-PER', 0.9), tok('##uazzani', 'I-PER', 0.9)];
  assert.deepEqual(align(text, tokens), [['Fatima Ouazzani', 'PERSON']]);
});

test('everyday words, months and days never join a name', () => {
  const text = 'email Rania Monday';
  const tokens = [tok('email', 'O'), tok('Rania', 'B-PER', 0.95), tok('Monday', 'O')];
  assert.deepEqual(align(text, tokens), [['Rania', 'PERSON']]);
});

test('"Surname, First" is one name', () => {
  const text = 'from Odeh, Tareq';
  const tokens = [tok('from', 'O'), tok('Odeh', 'O', 0.5), tok(',', 'O'), tok('Tareq', 'B-PER', 0.9)];
  assert.deepEqual(align(text, tokens), [['Odeh, Tareq', 'PERSON']]);
});

test('a particle cut from its surname is joined back', () => {
  const text = 'Saeed Al-Ketbi';
  const tokens = [tok('Saeed', 'B-PER', 0.9), tok('Al', 'I-PER', 0.9), tok('-', 'O'), tok('Ketbi', 'O', 0.5)];
  assert.deepEqual(align(text, tokens), [['Saeed Al-Ketbi', 'PERSON']]);
});

test('a place tagged on a first name before an Al- surname is a person', () => {
  const text = 'Mariam Al-Mansoori';
  const tokens = [tok('Mariam', 'B-LOC', 0.8), tok('Al', 'O'), tok('-', 'O'), tok('Mansoori', 'O')];
  assert.deepEqual(align(text, tokens), [['Mariam Al-Mansoori', 'PERSON']]);
});

test('a place followed by a company word becomes the organization', () => {
  const text = 'our partner Nile valley trading co.';
  const tokens = [tok('our', 'O'), tok('partner', 'O'), tok('Nile', 'B-LOC', 0.97), tok('valley', 'O'), tok('trading', 'O'), tok('co', 'O'), tok('.', 'O')];
  assert.deepEqual(align(text, tokens), [['Nile valley trading co', 'ORGANIZATION']]);
});

test('without a vocabulary, alignTokens behaves as before', () => {
  const text = 'see Lina Qasem';
  const tokens = [tok('see', 'O'), tok('Lina', 'B-PER', 0.95), tok('Qasem', 'O', 0.6)];
  assert.deepEqual(pairs(alignTokens(text, tokens)), [['Lina', 'PERSON']]);
});

test('truecase: accented capitals and capital runs in a normal line are lowered', () => {
  assert.equal(truecase('Owner - BÊRIVAN OMER', isKnownWord), 'Owner - Bêrivan Omer');
  assert.equal(truecase('please email OMAR FAROUK about it', isKnownWord), 'please email Omar Farouk about it');
  assert.equal(truecase('our partner NASA ESA', isKnownWord), 'our partner NASA ESA');
});

test('truecase: flipped case, Arabic particles and initials', () => {
  assert.equal(truecase('see gEoRgEs aBi nAdEr', isKnownWord), 'see Georges Abi Nader');
  assert.equal(truecase('contact ahmed el-sayed', isKnownWord), 'contact Ahmed El-Sayed');
  assert.equal(truecase('from t. odeh', isKnownWord), 'from T. Odeh');
  assert.equal(truecase('JavaScript and iPhone stay', isKnownWord), 'JavaScript and iPhone Stay');
});

test('truecase: exam and degree names stay as typed', () => {
  assert.equal(truecase('my toefl and ielts', isKnownWord), 'my toefl and ielts');
});

test('truecase never changes the length', () => {
  for (const s of ['Owner - BÊRIVAN OMER', 'see gEoRgEs aBi nAdEr', 'contact ahmed el-sayed', 'İSTANBUL OFİS']) {
    assert.equal(truecase(s, isKnownWord).length, s.length, s);
  }
});

test('a comma join never eats the next word or a second person (review finding)', () => {
  const t = (text, tokens) => align(text, tokens);
  assert.deepEqual(t('Thanks Sarah, I\'ll ask', [tok('Thanks', 'O'), tok('Sarah', 'B-PER'), tok(',', 'O'), tok('I', 'O'), tok("'", 'O'), tok('ll', 'O'), tok('ask', 'O')]),
    [['Sarah', 'PERSON']]);
  assert.deepEqual(t('Thanks Layla, Inshallah we meet', [tok('Thanks', 'O'), tok('Layla', 'B-PER'), tok(',', 'O'), tok('Inshallah', 'O'), tok('we', 'O'), tok('meet', 'O')]),
    [['Layla', 'PERSON']]);
  assert.deepEqual(t('ask Sarah, Ahmed', [tok('ask', 'O'), tok('Sarah', 'B-PER'), tok(',', 'O'), tok('Ahmed', 'B-PER')]),
    [['Sarah', 'PERSON'], ['Ahmed', 'PERSON']]);
});

test('a proper noun across a comma mid-sentence is its own person, not merged', () => {
  const text = 'Thanks Layla, Zaid will join';
  const tokens = [tok('Thanks', 'O'), tok('Layla', 'O', 0.51), tok(',', 'O'), tok('Z', 'B-PER', 1), tok('##aid', 'B-PER', 1), tok('will', 'O'), tok('join', 'O')];
  assert.deepEqual(align(text, tokens), [['Layla', 'PERSON'], ['Zaid', 'PERSON']]);
});

test('a proper noun after a person label is a person, however unsure the model', () => {
  const text = '  Contact   Karim  ';
  const tokens = [tok('Contact', 'O'), tok('Ka', 'B-PER', 0.35), tok('##rim', 'B-PER', 0.3)];
  assert.deepEqual(align(text, tokens), [['Karim', 'PERSON']]);
  assert.deepEqual(align('"contact": "Shilan"', [tok('"', 'O'), tok('contact', 'O'), tok('"', 'O'), tok(':', 'O'), tok('"', 'O'), tok('Shilan', 'B-MISC', 0.7), tok('"', 'O')]),
    [['Shilan', 'PERSON']]);
  assert.deepEqual(align('contact Support today', [tok('contact', 'O'), tok('Support', 'O'), tok('today', 'O')]), []);
});

test('lowercase company phrases with a proper noun are organizations', () => {
  const text = 'our partner Carthage textiles';
  const tokens = [tok('our', 'O'), tok('partner', 'O'), tok('Carthage', 'O', 0.5), tok('textiles', 'O')];
  assert.deepEqual(align(text, tokens), [['Carthage textiles', 'ORGANIZATION']]);
});

test('a name never starts on the dot of a title', () => {
  const text = 'Prof. Abu Bakr';
  const tokens = [tok('Prof', 'O'), tok('.', 'B-PER', 0.6), tok('Abu', 'I-PER', 0.9), tok('Bakr', 'I-PER', 0.9)];
  assert.deepEqual(align(text, tokens), [['Abu Bakr', 'PERSON']]);
});

test('regional titles never become or join a name (found live: "Eng.")', () => {
  const text = 'Signed: Eng. Samir Haddad';
  const tokens = [tok('Sign', 'O'), tok('##ed', 'O'), tok(':', 'O'), tok('En', 'B-PER', 0.75), tok('##g', 'B-PER', 0.84), tok('.', 'B-PER', 0.97),
    tok('Sami', 'B-PER', 0.97), tok('##r', 'B-PER', 0.96), tok('Had', 'I-PER', 1), tok('##dad', 'I-PER', 1)];
  assert.deepEqual(align(text, tokens), [['Samir Haddad', 'PERSON']]);
  assert.deepEqual(align('Contact Eng. Samir', [tok('Contact', 'O'), tok('En', 'O'), tok('##g', 'O'), tok('.', 'O'), tok('Sami', 'B-PER'), tok('##r', 'B-PER')]),
    [['Samir', 'PERSON']]);
});

// Found while rebuilding store images: "Rashid at Gulf" read as an "at-" particle
// surname, so the person swallowed "Gulf" and "Petro Services" was sent as typed.
test('English words that double as particles (at, as) never join across a space', () => {
  const text = 'reply to Ahmed Rashid at Gulf Petro Services today';
  const tokens = [tok('reply', 'O'), tok('to', 'O'), tok('Ahmed', 'B-PER', 1), tok('Rashid', 'I-PER', 0.97), tok('at', 'O'),
    tok('Gulf', 'B-ORG', 1), tok('Pet', 'I-ORG', 1), tok('##ro', 'I-ORG', 1), tok('Services', 'I-ORG', 1), tok('today', 'O')];
  assert.deepEqual(align(text, tokens), [['Ahmed Rashid', 'PERSON'], ['Gulf Petro Services', 'ORGANIZATION']]);

  const role = 'signed by Omar Haddad as Director';
  const roleTokens = [tok('signed', 'O'), tok('by', 'O'), tok('Omar', 'B-PER', 1), tok('Haddad', 'I-PER', 1), tok('as', 'O'), tok('Director', 'O')];
  assert.deepEqual(align(role, roleTokens), [['Omar Haddad', 'PERSON']]);
});

test('the same particles still join with a hyphen ("at-Tahir")', () => {
  const text = 'Hassan at-Tahir';
  const tokens = [tok('Hassan', 'B-PER', 0.9), tok('at', 'O'), tok('-', 'O'), tok('Tahir', 'O', 0.5)];
  assert.deepEqual(align(text, tokens), [['Hassan at-Tahir', 'PERSON']]);
});
