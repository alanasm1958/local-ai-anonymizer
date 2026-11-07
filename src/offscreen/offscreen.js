// Hidden page that hosts the built-in NER model. The service worker cannot
// run it directly (no dynamic import in MV3 workers, which ONNX Runtime needs).
// Only answers messages addressed with target: 'offscreen'.

import { pipeline, env } from '../../vendor/transformers/transformers.min.js';
import { detectWithModel, BUILTIN_MODEL } from '../core/ner.js';
import { vocabularyLookup } from '../core/truecase.js';

const LOAD_WAIT_MS = 20000;
const IDLE_CLOSE_MS = 10 * 60 * 1000;
const MODELS_URL = chrome.runtime.getURL('vendor/models/');

// MV3 forbids remote code, so the wasm runtime is always the bundled copy.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
env.backends.onnx.wasm.numThreads = 1;

const state = { status: 'idle', progress: 0, source: null, error: null };
let loading = null;
let idleTimer = null;
let isKnownWord = null; // the model's vocabulary, for truecasing lowercase names

// The model ships in vendor/ (npm run vendor). Remote loading stays off even
// when it is missing: failing closed keeps the "nothing leaves this device"
// promise, and patterns still run while the error is shown in Settings.
async function useBundledModel() {
  const res = await fetch(`${MODELS_URL}${BUILTIN_MODEL.id}/config.json`).catch(() => null);
  if (!res?.ok) throw new Error('Built-in model files are missing. Run "npm run vendor" and reload the extension.');
  env.localModelPath = MODELS_URL;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  return 'bundled';
}

function trackProgress() {
  const files = new Map();
  return (event) => {
    if (event.status !== 'progress' || !event.total) return;
    files.set(event.file, { loaded: event.loaded, total: event.total });
    const totals = [...files.values()].reduce((acc, f) => ({ loaded: acc.loaded + f.loaded, total: acc.total + f.total }), { loaded: 0, total: 0 });
    state.progress = Math.round((totals.loaded / totals.total) * 100);
  };
}

function loadModel() {
  loading ??= (async () => {
    state.status = 'loading';
    state.source = await useBundledModel();
    const classifier = await pipeline('token-classification', BUILTIN_MODEL.id, {
      dtype: BUILTIN_MODEL.dtype,
      device: 'wasm',
      progress_callback: trackProgress(),
    });
    state.status = 'ready';
    state.progress = 100;
    return classifier;
  })().catch((err) => {
    loading = null;
    state.status = 'error';
    state.error = err?.message ?? String(err);
    throw err;
  });
  return loading;
}

const timeout = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));

async function detect({ text, types }) {
  const classifier = await Promise.race([
    loadModel(),
    timeout(LOAD_WAIT_MS, `Built-in model is still loading (${state.progress}%). Names were not checked this time.`),
  ]);
  isKnownWord ??= vocabularyLookup(classifier.tokenizer.get_vocab());
  return detectWithModel(text, (chunk) => classifier(chunk, { ignore_labels: [] }), types, {
    countTokens: (chunk) => classifier.tokenizer(chunk).input_ids.dims.at(-1),
    isKnownWord,
  });
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => chrome.runtime.sendMessage({ type: 'offscreenIdle' }), IDLE_CLOSE_MS);
}

const HANDLERS = Object.freeze({
  ner: detect,
  nerStatus: async () => ({ ...state }),
  nerWarmup: async () => {
    loadModel().catch(() => undefined);
    return { ...state };
  },
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own worker and pages, never content scripts in a tab.
  if (sender.tab || message?.target !== 'offscreen' || !Object.hasOwn(HANDLERS, message.type)) return false;
  touch();
  HANDLERS[message.type](message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message ?? String(err) }));
  return true;
});

touch();
