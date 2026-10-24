# Local AI Anonymizer

A Chrome / Edge / Brave extension that removes sensitive information from text **before** it reaches ChatGPT, Claude, Gemini, Copilot, Perplexity and other AI tools. Detection runs on a model on your own computer. Nothing is sent to any cloud service.

```
You paste:   Maria Gonzalez from Northwind Traders, maria@northwind.example, card 4111 1111 1111 1111
AI receives: [PERSON_1] from [ORGANIZATION_1], [EMAIL_1], card [CREDIT_CARD_1]
```

The AI's answer can be turned back into real names with one click (popup, **Restore** tab, or right-click, **Restore originals in selection**).

## How it works

| Layer | Detects | Where it runs |
|-------|---------|---------------|
| Pattern detectors | Emails, phone numbers, credit cards (Luhn checked), US SSNs, IPv4/IPv6, IBANs (checksum verified), API keys and tokens, `password=` style secrets, private key blocks, URLs (off by default) | In the extension, instantly |
| Local model | People's names, companies, street addresses, places, ID / account / case numbers | Ollama or any OpenAI-compatible server on `localhost` |

The model only *finds* entities. Replacement is done by the extension, so a confused model can never rewrite or drop your text. If the model is offline, the extension still applies the pattern detectors and warns you (or blocks the paste, if you prefer).

Placeholders are consistent: the same person is `[PERSON_1]` every time in a browser session. The mapping lives in memory only (`chrome.storage.session`) and is erased when the browser closes, or when you press **Clear vault**.

## Install

### 1. Run a local model

```bash
brew install ollama
```

```bash
ollama pull llama3.2
```

Then start the Ollama app (or run `ollama serve`). Any instruction-tuned model works. Bigger models (for example `qwen3:8b` or `llama3.1:8b`) catch more names; small ones (`llama3.2`, 3B) are faster.

LM Studio, llama.cpp server or vLLM also work: pick **OpenAI-compatible** in Settings and use its URL, for example `http://localhost:1234/v1`.

### 2. Load the extension

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open the extension's **Settings** and press **Test detection**.

If the test reports HTTP 403, Ollama is rejecting the extension's origin. The extension normally removes that header for its own requests. If your setup still blocks it, start Ollama with:

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

## Using it

- **Paste on a supported AI site:** text is anonymized automatically. A small panel shows what was replaced. If the model fails and you chose "Block the paste", the panel offers **Insert original anyway**.
- **Any text box on any site:** press `Alt+Shift+A` to anonymize the box (or just the selected part).
- **Any selected text:** right-click, then **Anonymize selection** or **Restore originals in selection**.
- **Popup:** anonymize or restore text by hand, pause protection for the current site, view the vault.
- **Settings:** model, endpoint, which data types to catch, which sites get automatic paste protection (you can add your own, such as an internal AI portal).

## Privacy model

- The only network requests go to the model endpoint you configure. It defaults to `localhost`, and Settings warns you if you point it elsewhere.
- The `Origin`-removal rule applies **only** to requests this extension makes (`initiatorDomains` is the extension's own ID), so websites cannot use it to reach your local model.
- The paste listener registers at `document_start`, before any page script, so the AI site never sees the raw clipboard text.
- The on-page panel lives in a closed shadow root in the extension's isolated world, out of reach of page scripts.

- Content scripts only get the anonymize / restore / site-status messages. Reading the vault or changing settings is limited to the extension's own pages.
- Placeholder numbers are never reused, even after **Clear vault** or a browser restart (only the per-type counts are kept, never the values). An old `[PERSON_1]` in a chat therefore can't be "restored" to a different person.

Limits to be aware of: automatic detection is a safety net, not a guarantee.
- Small models miss some names, and unusual identifiers may not match any pattern.
- Text that is **dragged and dropped** into a box is not intercepted. Only paste is.
- Pasted text that tries to instruct the model ("return no entities") can suppress name detection. Pattern detection is unaffected.

Glance at the replacement panel before you send anything highly sensitive.

## Development

No build step. Plain ES modules, no runtime dependencies.

```bash
npm test
```

```bash
npm run coverage
```

```bash
npm run test:e2e
```

`test:e2e` loads the extension into Playwright's Chromium, serves a fake `chatgpt.com` page, runs a mock Ollama on port 11434 (stop a real Ollama first) and checks that pastes into a textarea, a ProseMirror-style editor, a bare `contenteditable` and a textarea inside a shadow root all arrive anonymized, that the model never sees an `Origin` header, and that placeholder numbers survive a vault reset. Install the browser once with `npx playwright-core install chromium` if needed.

Regenerate icons with `python3 scripts/make-icons.py`.

```
src/core/        pure logic: detectors, span resolution, vault, model client, settings
src/background/  service worker: message router, storage, menus, DNR rule
src/content/     paste interception and on-page panel
src/popup/       toolbar popup
src/options/     settings page
tests/           unit, integration (mock Ollama) and e2e suites
```
