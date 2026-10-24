# AE Extension: Local AI Anonymizer

Chrome / Edge / Brave (Manifest V3) extension that strips sensitive information out of text before it is pasted into AI tools (ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek). Detection runs fully on the user's machine: regex validators for structured data plus a local LLM (Ollama or any OpenAI-compatible server such as LM Studio) for names, organizations and addresses. Nothing is sent anywhere except the local model endpoint.

## Layout

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `src/core/` | Pure ES modules, no `chrome.*` calls. All logic that can be unit tested lives here. |
| `src/background/service-worker.js` | Message router, storage, context menus, keyboard command. Only place that calls the model. |
| `src/content/content.js` | Classic script (MV3 content scripts cannot be ES modules). Intercepts paste, shows toasts. Talks to the worker via `chrome.runtime.sendMessage`. |
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

## Commands

```bash
npm test            # unit + integration tests
npm run coverage    # tests with coverage report
npm run test:e2e    # real Chromium + extension (needs port 11434 free)
python3 scripts/make-icons.py   # regenerate icons/
```

No build step. Load the folder unpacked at `chrome://extensions`.
