import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgSuffixSpans } from '../src/core/orgs.js';

const found = (text) => orgSuffixSpans(text).map((s) => s.value);

test('capitalized names ending in a company word are organizations', () => {
  assert.deepEqual(found('Northwind Traders paid with card 4111.'), ['Northwind Traders']);
  assert.deepEqual(found('Contract with Brightline Logistics Ltd and Harbor & Finch LLP.'), ['Brightline Logistics Ltd', 'Harbor & Finch LLP']);
  assert.deepEqual(found('Invoice for Smith & Sons via Acme Holdings Inc.'), ['Smith & Sons', 'Acme Holdings Inc']);
  assert.deepEqual(found('She studied at Stanford University and works at Nordic Biotech GmbH.'), ['Stanford University', 'Nordic Biotech GmbH']);
});

test('leading command and function words are not part of the name', () => {
  assert.deepEqual(found('Call Northwind Traders today'), ['Northwind Traders']);
  assert.deepEqual(found('The Basra Oil Company report'), ['Basra Oil Company']);
  assert.deepEqual(found('Our Acme Holdings office'), ['Acme Holdings']);
  assert.deepEqual(found('Explain Brightline Logistics Ltd results'), ['Brightline Logistics Ltd']);
});

test('lowercase words and lone company words are left alone', () => {
  assert.deepEqual(found('the services team and our group chat'), []);
  assert.deepEqual(found('Services are down. Group meeting at 3.'), []);
  assert.deepEqual(found('Ask the Bank about it'), []);
});

test('spans carry offsets and the ORGANIZATION type', () => {
  const [span] = orgSuffixSpans('Pay Northwind Traders now');
  assert.equal(span.type, 'ORGANIZATION');
  assert.equal('Pay Northwind Traders now'.slice(span.start, span.end), 'Northwind Traders');
});

test('long runs of capitalized words stay fast', () => {
  const started = Date.now();
  orgSuffixSpans('Alpha '.repeat(50000));
  assert.ok(Date.now() - started < 500);
});

// Found by review: ordinary Title Case phrases are not organizations.
test('generic Title Case phrases are not organizations', () => {
  for (const text of [
    'Explain Gradient Boosting Trust Region', 'Use Data Science Consulting', 'Machine Learning Systems Design',
    'Natural Language Processing Group', 'Final Project Group meeting', 'Introduction To Energy Capital', 'Monday Trading',
  ]) {
    assert.deepEqual(found(text), [], text);
  }
});
