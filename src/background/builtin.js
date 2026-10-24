// Worker side of the built-in model: owns the offscreen document and exposes
// the same detectEntities interface as the Ollama client.

import { BUILTIN_MODEL } from '../core/ner.js';

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
const TOTAL_TIMEOUT_MS = 60000;

let creating = null;

const ALREADY_EXISTS = /single offscreen document/i;

export async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: 'Runs the local name-detection model so text never leaves the device',
  }).catch((err) => {
    // Another caller won the race between hasDocument() and createDocument().
    if (!ALREADY_EXISTS.test(err?.message ?? '')) throw err;
  }).finally(() => { creating = null; });
  await creating;
}

export async function closeOffscreen() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

const NOT_LISTENING = /Receiving end does not exist/;
const LISTENER_RETRIES = 30;
const RETRY_DELAY_MS = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// createDocument resolves before the page's module has run, so the first
// message can arrive before its listener exists. The page may also have just
// closed itself for idleness, so make sure it exists on every retry.
async function sendWhenReady(message) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (!NOT_LISTENING.test(err?.message ?? '') || attempt >= LISTENER_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS);
      await ensureOffscreen();
    }
  }
}

async function ask(type, payload = {}, timeoutMs = TOTAL_TIMEOUT_MS) {
  await ensureOffscreen();
  const reply = await Promise.race([
    sendWhenReady({ target: 'offscreen', type, ...payload }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Built-in model did not respond in time')), timeoutMs)),
  ]);
  if (!reply?.ok) throw new Error(reply?.error ?? 'Built-in model did not respond');
  return reply.data;
}

export const builtinClient = Object.freeze({
  detectEntities: (text, types) => ask('ner', { text, types }),
  listModels: async () => [BUILTIN_MODEL.label],
});

export const builtinStatus = () => ask('nerStatus', {}, 5000);

export const warmUpBuiltin = () => ask('nerWarmup', {}, 5000);
