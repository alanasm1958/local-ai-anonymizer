// Launches headless Chromium with the unpacked extension, every outbound
// request going through the recording proxy, and `page` served at each of
// `sites`. Run `npm run vendor` first (the built-in model loads from vendor/).

import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startRecordingProxy } from './recording-proxy.js';

// EXTENSION_PATH lets a suite run against an unzipped release package.
export const EXTENSION_PATH = process.env.EXTENSION_PATH ?? fileURLToPath(new URL('../../', import.meta.url));

export async function launchExtension({ page, sites = ['https://chatgpt.com/**'] }) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'anonymizer-e2e-'));
  const proxy = await startRecordingProxy();
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    // Explicit bypass: Playwright otherwise forces loopback through the proxy.
    proxy: { server: proxy.url, bypass: 'localhost,127.0.0.1,[::1]' },
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  for (const site of sites) {
    await context.route(site, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: page }));
  }
  const close = async () => {
    await context.close();
    await proxy.close();
    await rm(userDataDir, { recursive: true, force: true });
  };
  return { context, worker, proxy, close };
}

export async function openPage(context, url = 'https://chatgpt.com/') {
  const page = await context.newPage();
  await page.goto(url);
  // Wait until the content script has asked the worker for its site status.
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(300);
  return page;
}

export async function patchSettings(worker, patch) {
  await worker.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...p } });
  }, patch);
}
