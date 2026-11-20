import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowGuide, GUIDE_PATH } from '../src/core/welcome.js';

test('a fresh install by IT policy or the store opens the guide', () => {
  assert.equal(shouldShowGuide('install', 'admin'), true);
  assert.equal(shouldShowGuide('install', 'normal'), true);
});

test('updates, browser updates and unpacked development copies do not', () => {
  assert.equal(shouldShowGuide('update', 'admin'), false);
  assert.equal(shouldShowGuide('chrome_update', 'normal'), false);
  assert.equal(shouldShowGuide('install', 'development'), false);
});

test('unknown or missing values never open a tab', () => {
  assert.equal(shouldShowGuide(undefined, 'admin'), false);
  assert.equal(shouldShowGuide('install', undefined), false);
  assert.equal(shouldShowGuide('install', 'other'), false);
});

test('the guide path points at the extension page', () => {
  assert.equal(GUIDE_PATH, 'src/help/help.html');
});
