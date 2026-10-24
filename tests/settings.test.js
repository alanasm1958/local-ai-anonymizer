import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings, isSiteEnabled, normalizeHost, isLocalEndpoint, BUILTIN_MODEL_TYPES } from '../src/core/settings.js';

test('mergeSettings fills missing values with defaults', () => {
  assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS);
  const merged = mergeSettings({ model: 'qwen3:4b', patternTypes: { URL: true } });
  assert.equal(merged.model, 'qwen3:4b');
  assert.equal(merged.patternTypes.URL, true);
  assert.equal(merged.patternTypes.EMAIL, true);
});

test('mergeSettings rejects invalid values', () => {
  const merged = mergeSettings({
    provider: 'cloud', endpoint: 'javascript:alert(1)', timeoutMs: -5,
    onModelError: 'explode', enabled: 'yes', customSites: ['ok.com', 42, ''],
    patternTypes: { EMAIL: 'no', MADE_UP: true },
  });
  assert.equal(merged.provider, DEFAULT_SETTINGS.provider);
  assert.equal(merged.endpoint, DEFAULT_SETTINGS.endpoint);
  assert.equal(merged.timeoutMs, DEFAULT_SETTINGS.timeoutMs);
  assert.equal(merged.onModelError, 'patterns');
  assert.equal(merged.enabled, true);
  assert.deepEqual(merged.customSites, ['ok.com']);
  assert.equal(merged.patternTypes.EMAIL, true);
  assert.equal('MADE_UP' in merged.patternTypes, false);
});

test('normalizeHost strips scheme, path and www', () => {
  assert.equal(normalizeHost('https://www.Example.com/chat?x'), 'example.com');
  assert.equal(normalizeHost('  claude.ai  '), 'claude.ai');
  assert.equal(normalizeHost('not a host!'), '');
});

test('isSiteEnabled respects the master switch, defaults and disabled list', () => {
  assert.equal(isSiteEnabled(DEFAULT_SETTINGS, 'chatgpt.com'), true);
  assert.equal(isSiteEnabled(DEFAULT_SETTINGS, 'www.perplexity.ai'), true);
  assert.equal(isSiteEnabled(DEFAULT_SETTINGS, 'example.com'), false);
  assert.equal(isSiteEnabled({ ...DEFAULT_SETTINGS, customSites: ['example.com'] }, 'app.example.com'), true);
  assert.equal(isSiteEnabled({ ...DEFAULT_SETTINGS, disabledSites: ['claude.ai'] }, 'claude.ai'), false);
  assert.equal(isSiteEnabled({ ...DEFAULT_SETTINGS, enabled: false }, 'claude.ai'), false);
});

test('isLocalEndpoint recognizes loopback hosts', () => {
  assert.equal(isLocalEndpoint('http://localhost:11434'), true);
  assert.equal(isLocalEndpoint('http://127.0.0.1:1234/v1'), true);
  assert.equal(isLocalEndpoint('http://[::1]:11434'), true);
  assert.equal(isLocalEndpoint('http://192.168.1.5:11434'), false);
  assert.equal(isLocalEndpoint('nope'), false);
});

test('isLocalEndpoint is not fooled by hostnames that start with 127.', () => {
  assert.equal(isLocalEndpoint('http://127.evil.com'), false);
  assert.equal(isLocalEndpoint('http://127.0.0.1.evil.com:11434'), false);
  assert.equal(isLocalEndpoint('https://localhost:8443'), true);
});

test('built-in model is the default provider and accepted from storage', () => {
  assert.equal(DEFAULT_SETTINGS.provider, 'builtin');
  assert.equal(mergeSettings({ provider: 'ollama' }).provider, 'ollama');
  assert.equal(mergeSettings({ provider: 'builtin' }).provider, 'builtin');
  assert.equal(DEFAULT_SETTINGS.restoreReplies, true);
  assert.equal(mergeSettings({ restoreReplies: false }).restoreReplies, false);
});

test('new pattern types default on and old stored settings pick them up', () => {
  const merged = mergeSettings({ patternTypes: { EMAIL: false } });
  for (const t of ['DATE_OF_BIRTH', 'ID_NUMBER', 'ADDRESS', 'POSTCODE']) assert.equal(merged.patternTypes[t], true);
  assert.equal(merged.patternTypes.EMAIL, false);
});

test('builtinTypes lists what the built-in model can find', () => {
  assert.deepEqual(BUILTIN_MODEL_TYPES, ['PERSON', 'ORGANIZATION', 'LOCATION']);
});

test('file checking and holding default on and can be turned off', () => {
  assert.equal(DEFAULT_SETTINGS.checkFiles, true);
  assert.equal(DEFAULT_SETTINGS.holdUncheckedFiles, true);
  const merged = mergeSettings({ checkFiles: false, holdUncheckedFiles: 'nope' });
  assert.equal(merged.checkFiles, false);
  assert.equal(merged.holdUncheckedFiles, true);
});
