import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns, luhnValid, ibanValid, isIPv6 } from '../src/core/detectors.js';

const ALL = {
  EMAIL: true, PHONE: true, CREDIT_CARD: true, SSN: true,
  IP_ADDRESS: true, IBAN: true, API_KEY: true, URL: true,
};

const values = (text, types = ALL) =>
  detectPatterns(text, types).map((s) => [s.type, s.value]);

test('luhnValid accepts real card numbers and rejects typos', () => {
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(luhnValid('4111111111111112'), false);
  assert.equal(luhnValid('12'), false);
});

test('ibanValid checks the mod-97 checksum', () => {
  assert.equal(ibanValid('GB82WEST12345698765432'), true);
  assert.equal(ibanValid('GB82 WEST 1234 5698 7654 32'), true);
  assert.equal(ibanValid('GB83WEST12345698765432'), false);
  assert.equal(ibanValid('GB82'), false);
});

test('isIPv6 accepts full and compressed forms, rejects clock times', () => {
  assert.equal(isIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true);
  assert.equal(isIPv6('fe80::1'), true);
  assert.equal(isIPv6('10:30:00'), false);
  assert.equal(isIPv6('1::2::3'), false);
  assert.equal(isIPv6('::'), false);
});

test('detects emails', () => {
  assert.deepEqual(values('Mail jane.doe+ai@example.co.uk now'), [['EMAIL', 'jane.doe+ai@example.co.uk']]);
});

test('detects phone numbers but not dates or short numbers', () => {
  assert.deepEqual(values('Call +1 (415) 555-0132 today'), [['PHONE', '+1 (415) 555-0132']]);
  assert.deepEqual(values('Call 07700 900123'), [['PHONE', '07700 900123']]);
  assert.deepEqual(values('Meeting on 2026-10-24 at 10:30'), []);
  assert.deepEqual(values('Order 12345 shipped'), []);
});

test('detects only Luhn-valid credit cards', () => {
  assert.deepEqual(values('Card 4111 1111 1111 1111 exp 12/27'), [['CREDIT_CARD', '4111 1111 1111 1111']]);
  assert.deepEqual(values('Card 4111 1111 1111 1112', { CREDIT_CARD: true }), []);
});

test('detects US SSNs and skips invalid area numbers', () => {
  assert.deepEqual(values('SSN 123-45-6789'), [['SSN', '123-45-6789']]);
  assert.deepEqual(values('SSN 000-45-6789', { SSN: true }), []);
});

test('detects IPv4 and IPv6 addresses', () => {
  assert.deepEqual(values('Server 192.168.1.20 and fe80::1ff:fe23:4567:890a'), [
    ['IP_ADDRESS', '192.168.1.20'],
    ['IP_ADDRESS', 'fe80::1ff:fe23:4567:890a'],
  ]);
  assert.deepEqual(values('Version 999.1.1.1', { IP_ADDRESS: true }), []);
});

test('detects valid IBANs', () => {
  assert.deepEqual(values('Pay to GB82 WEST 1234 5698 7654 32 please', { IBAN: true }), [
    ['IBAN', 'GB82 WEST 1234 5698 7654 32'],
  ]);
});

test('detects API keys, bearer tokens and secret assignments', () => {
  const text = [
    'key sk-proj-abcdefghijklmnopqrstuvwx1234',
    'aws AKIAIOSFODNN7EXAMPLE',
    'Authorization: Bearer abc123def456ghi789',
    'password = "hunter2!!"',
  ].join('\n');
  assert.deepEqual(values(text, { API_KEY: true }), [
    ['API_KEY', 'sk-proj-abcdefghijklmnopqrstuvwx1234'],
    ['API_KEY', 'AKIAIOSFODNN7EXAMPLE'],
    ['API_KEY', 'abc123def456ghi789'],
    ['API_KEY', 'hunter2!!'],
  ]);
});

test('detects private key blocks as one span', () => {
  const text = 'x\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----\ny';
  const spans = detectPatterns(text, { API_KEY: true });
  assert.equal(spans.length, 1);
  assert.ok(spans[0].value.startsWith('-----BEGIN RSA PRIVATE KEY-----'));
  assert.ok(spans[0].value.endsWith('-----END RSA PRIVATE KEY-----'));
});

test('URL detection is opt-in and trims trailing punctuation', () => {
  const text = 'See https://intranet.acme.com/u/42?x=1.';
  assert.deepEqual(values(text, { URL: false }), []);
  assert.deepEqual(values(text, { URL: true }), [['URL', 'https://intranet.acme.com/u/42?x=1']]);
});

test('spans carry offsets that match the original text', () => {
  const text = 'a@b.io and 192.168.0.1';
  for (const span of detectPatterns(text, ALL)) {
    assert.equal(text.slice(span.start, span.end), span.value);
    assert.equal(span.source, 'pattern');
  }
});

test('disabled types are not detected', () => {
  assert.deepEqual(values('a@b.io', { EMAIL: false }), []);
  assert.deepEqual(values('a@b.io', {}), []);
});

test('card followed by CVV or expiry is still detected', () => {
  assert.deepEqual(values('Card 4111 1111 1111 1111 123', { CREDIT_CARD: true }), [['CREDIT_CARD', '4111 1111 1111 1111']]);
  assert.deepEqual(values('4111111111111111 12 25', { CREDIT_CARD: true }), [['CREDIT_CARD', '4111111111111111']]);
});

test('IBAN followed by a currency code is detected whole', () => {
  assert.deepEqual(values('BE68 5390 0754 7034 EUR', ALL), [['IBAN', 'BE68 5390 0754 7034']]);
  assert.deepEqual(values('BE68539007547034 EUR', { IBAN: true }), [['IBAN', 'BE68539007547034']]);
});

test('secrets with prefixed keys and JSON style are detected', () => {
  const text = 'DB_PASSWORD=hunter22\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n{"access_token": "abc123xyz"}';
  assert.deepEqual(values(text, { API_KEY: true }).map(([, v]) => v), ['hunter22', 'wJalrXUtnFEMI', 'abc123xyz']);
});

test('pathological 200k inputs finish quickly (no ReDoS)', () => {
  for (const input of ['a.'.repeat(100000), '12-'.repeat(66000), `a@${'b.'.repeat(100000)}`, 'a-'.repeat(100000)]) {
    const started = Date.now();
    detectPatterns(input, ALL);
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms on ${input.slice(0, 6)}...`);
  }
});
