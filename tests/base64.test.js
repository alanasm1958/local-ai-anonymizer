import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, base64ToBytes } from '../src/core/base64.js';

test('base64 round-trips binary data larger than one chunk', () => {
  const bytes = new Uint8Array(100000).map((_, i) => (i * 31) % 256);
  const encoded = bytesToBase64(bytes);
  assert.equal(encoded, Buffer.from(bytes).toString('base64'));
  assert.deepEqual(base64ToBytes(encoded), bytes);
});

test('empty input', () => {
  assert.equal(bytesToBase64(new Uint8Array()), '');
  assert.deepEqual(base64ToBytes(''), new Uint8Array());
});
