# AE Extension: Local AI Anonymizer

Chrome / Edge / Brave (Manifest V3) extension that strips sensitive information out of text before it is pasted into AI tools (ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek), and shows real values again in AI replies on the user's screen only. Detection runs fully on the user's machine: regex validators for structured data plus a bundled in-browser NER model (DistilBERT-NER, English, 66 MB, via Transformers.js) for people, organizations and places. Ollama / OpenAI-compatible local servers are an optional engine.

The user chose the smaller English-only model over a multilingual one (2026-10-24).

## Layout

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `src/core/` | Pure ES modules, no `chrome.*` calls. All logic that can be unit tested lives here. |
| `src/background/service-worker.js` | Message router, storage, context menus, keyboard command. Only place that calls the model. |
| `src/content/content.js` | Classic script (MV3 content scripts cannot be ES modules). Intercepts paste, shows toasts. Talks to the worker via `chrome.runtime.sendMessage`. |
| `src/content/reveal.js` | Loaded before content.js (shared isolated world, exposed as `globalThis.__anonymizerReveal`). Shows real values in replies via spans whose visible text is in a CLOSED shadow root; the page DOM keeps the placeholder. Never touches editable elements. |
| `src/core/ner.js` | Model id/constants, `alignTokens` (word pieces with no offsets back to text spans), `detectWithModel` (chunking). Stoplist `NEVER_ENTITIES`. |
| `src/offscreen/` | Hidden page that runs Transformers.js (the MV3 worker can't: no dynamic `import()`). Only answers messages with `target: 'offscreen'`. Closes itself after 10 idle minutes. |
| `src/background/builtin.js` | Creates the offscreen doc, retries while its listener registers, exposes `builtinClient.detectEntities`. |
| `scripts/vendor.mjs` | Copies `transformers.min.js` (self-contained build; the `.web` build has bare imports) and ORT `asyncify` wasm into `vendor/`, downloads the model. Runs on `npm install`. `vendor/` is gitignored. |
| `scripts/eval-ner.mjs` + `tests/eval/samples.js` | Detection-quality eval in Node (`npm run eval`). |
| `src/background/state.js` | Settings (`storage.local`), vault (`storage.session`), vault mutex, worker keep-alive |
| `src/background/integrations.js` | Dynamic DNR rule that strips `Origin` on requests to the model host (scoped to `initiatorDomains: [extension id]` so pages cannot abuse it), custom-site content script registration, badge |
| `src/popup/` | Manual anonymize / restore UI and on/off toggle |
| `src/options/` | Endpoint, model, entity types, sites |
| `src/ui/` | Shared theme CSS and messaging helpers for extension pages |
| `tests/` | `*.test.js`: unit + mock-Ollama integration. `tests/e2e/*.e2e.js`: Playwright loads the real extension, fakes chatgpt.com via `context.route`, mock Ollama on :11434 |

## Key design rules

- Placeholders look like `[PERSON_1]`. The vault (placeholder to original mapping) lives in `chrome.storage.session` only, so it is wiped when the browser closes.
- The vault is immutable: every core function returns a new vault object.
- Regex (validated) spans win over LLM spans when they overlap; longer spans win over shorter ones.
- If the local model fails, fall back to pattern-only detection and tell the user in the toast (configurable to cancel the paste instead).
- Content script runs at `document_start` so its window capture-phase paste listener is registered before any page script.
- `[hidden] { display: none !important }` in `src/ui/theme.css` is load-bearing: component `display` rules otherwise override `hidden`.
- No em dashes in copy or docs (user preference).
- MV3 forbids remote code: Transformers.js defaults `wasmPaths` to the jsdelivr CDN, so offscreen.js must point it at `vendor/ort/`. CSP needs `'wasm-unsafe-eval'`.
- Real values must never enter the AI page's DOM. Keep reveal output inside closed shadow roots and test with the e2e `pageReadable` check.
- Reveal is also a layout side channel (the page can measure the rendered width). Mitigations, all load-bearing: the vault records `sites` per placeholder and `lookup` only answers for the sender's own site (`lookupForSite`); `isRevealable` excludes secret types; reveal.js renders with unquoted generic `monospace` and `all: initial` so page CSS and @font-face can't control glyph widths.

## Commands

```bash
npm test            # unit + integration tests
npm run coverage    # tests with coverage report
npm run test:e2e    # real Chromium + extension + real built-in model (needs vendor/ and port 11434 free)
npm run vendor      # rebuild vendor/ (runtime + model)
npm run eval        # detection quality per model
python3 scripts/make-icons.py   # regenerate icons/
```

No build step. Load the folder unpacked at `chrome://extensions`.
