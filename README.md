# Local AI Anonymizer

A Chrome / Edge / Brave extension that removes sensitive information from text **before** it reaches ChatGPT, Claude, Gemini, Copilot, Perplexity and other AI tools, then shows the real values again in the AI's answer, on your screen only.

A small model is bundled and runs inside the browser. Nothing to install, and nothing is sent to any server.

```
You paste:      Ahmed Al-Rashid at Gulf Petro Services (ahmed@gulfpetro.example, DOB: 03/11/1987), based in Basra.
AI receives:    [PERSON_1] at [ORGANIZATION_1] ([EMAIL_1], DOB: [DATE_OF_BIRTH_1]), based in [LOCATION_1].
AI replies:     Dear [PERSON_1], thank you for reaching out on behalf of [ORGANIZATION_1]...
You see:        Dear Ahmed Al-Rashid, thank you for reaching out on behalf of Gulf Petro Services...
```

## How it works

| Layer | Detects | How |
|-------|---------|-----|
| **1. Rules** (exact, instant) | Emails, phone numbers (numbering plans for 18 Middle East and North Africa countries, local or international, Arabic-Indic and Persian digits too), credit cards (checksum verified), IBANs (checksum verified, any case), US SSNs, IP addresses, API keys and passwords, private keys, dates of birth (after "DOB", "born on", تاريخ الميلاد), ID / passport / national ID / civil ID / iqama / CIN / account / case numbers (after those words, in English or Arabic), street addresses, UK postcodes and US state + ZIP, URLs (off by default) | Regular expressions with validators |
| **2. Built-in model** (default) | People, companies and organizations, places | DistilBERT-NER (English, 66 MB), runs in the browser with Transformers.js |
| **2b. Ollama** (optional) | All of the above plus addresses and ID numbers written in free text | Any model you run with Ollama, LM Studio or another OpenAI-compatible server on `localhost` |
| **3. Restore** | Puts real values back into AI replies | Automatic on supported sites, or by hand in the popup |

Rules run first and win any overlap: they are exact on clear formats. The model only *finds* entities; the extension does the replacing, so a model can never rewrite or drop your text. If the model is unavailable, the rules still run and you get a warning (or the paste is blocked, if you prefer).

Placeholders are consistent: the same person is `[PERSON_1]` throughout a browser session. The mapping lives in memory only (`chrome.storage.session`) and is erased when the browser closes or you press **Clear vault**. Placeholder numbers are never reused, so an old `[PERSON_1]` can't be restored to a different person.

### Detection quality

Measured with `npm run eval` on 25 hand-written samples (support tickets, HR, medical, legal; names from many origins):

| Setup | Sensitive values caught | Safe phrases kept | Speed |
|-------|------------------------|-------------------|-------|
| Rules only | 30.5% | 100% | instant |
| Rules + built-in DistilBERT-NER | 98.8% | 100% | about 4 ms per sample |
| Rules + BERT-base-NER (109 MB, not bundled) | 100% | 100% | about 8 ms per sample |

The sample set was also used to tune the extension, so expect real-world numbers to be somewhat lower. Single first names on their own ("Carlos") are the most common miss.

A second, larger test (`npm run stress`) generates 3,498 cases for users across the Middle East and North Africa: 14 countries' phone numbers, IDs and IBANs, regional names in every casing (Title, lower, UPPER, mIxEd), 17 places in the text (tables, CSV, JSON, signatures, long pastes) and copy-paste traps (zero-width spaces, right-to-left marks, Arabic-Indic digits). Its leak check is strict: one surname or any 4 digits left behind counts as a leak. Current result (2026-11-08): 3,501 cases, 3,309 pass, 4 fail, no ordinary sentence hidden by mistake. Phones, IDs, IBANs, cards, dates of birth, emails, keys, IPs, Western addresses and organizations: no leaks. Names: 1,260 of 1,262 caught. Also checked live on ChatGPT, Claude.ai and Gemini with real keyboard pastes: no leaks. Not covered yet: names written in Arabic script, regional addresses ("Building 5, Street 9, Maadi").

## Install

Works on **Windows, macOS and Linux** in Chrome, Edge and Brave version 128 or newer. Every change is tested on Windows and macOS by GitHub Actions.

### From the release zip (no setup)

1. Unzip `local-ai-anonymizer-<version>.zip`.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped folder.
5. Open the extension's **Settings** and press **Test detection**. It should answer in well under a second.

### From source

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

`npm install` also runs `npm run vendor`, which copies the model runtime into `vendor/` and downloads the model (about 90 MB in total) so the extension works fully offline afterwards. Then load this folder with **Load unpacked** as above.

To share it with others, build the zip (about 57 MB):

```bash
npm run package
```

The zip lands in `dist/` and contains only the manifest, icons, source and the bundled model. It is byte-identical for the same sources on any platform.

### Keyboard shortcut

`Alt+Shift+A` on Windows and Linux, `Option+Shift+A` on a Mac. Change it at `chrome://extensions/shortcuts` (or `edge://extensions/shortcuts`).

### Optional: Ollama

The built-in model handles names, companies and places. For a larger model that also understands addresses and case numbers written in free text, install Ollama and download a model.

**macOS:**

```bash
brew install ollama
```

**Windows:** run the installer from [ollama.com/download](https://ollama.com/download).

Then, on either:

```bash
ollama pull llama3.2
```

Pick **Ollama** as the engine in Settings. LM Studio, llama.cpp server and vLLM work too via **OpenAI-compatible**.

If the test reports HTTP 403, Ollama is refusing the extension. Allow it, then restart Ollama.

**macOS:**

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```

**Windows (PowerShell):**

```powershell
setx OLLAMA_ORIGINS "chrome-extension://*"
```

## Using it

- **Paste or drag text into a supported AI site:** it is anonymized automatically and a small panel shows what was replaced. This covers:
  - rich-text-only clipboard content (converted to plain text first);
  - embedded frames;
  - sites that accept a paste anywhere on the page and route it into their message box.

  Password, number and date fields are left alone. Moving text around inside the message box is not intercepted.
- **Type and send:** when you press Enter (or Ctrl/Cmd+Enter) or click a Send button, a typed message is checked first. If it holds sensitive data, the send waits, the message box is anonymized, then the send goes ahead. A background check after each pause in typing lets clean messages go through instantly as the real keystroke. Shift+Enter (new line) is never held. If the check fails, nothing is sent and the panel offers **Send anyway**. Turn it off in Settings ("Check typed text before it is sent").
- **Attach files:** files you pick, drag or paste into a protected AI site are cleaned before the site receives them:
  - text and code files, CSV and JSON;
  - Word (`.docx`), Excel (`.xlsx`) and PowerPoint (`.pptx`), with formatting kept and author names removed.

  PDFs, images and other formats can't be checked, so they are held and you choose whether to upload them anyway (switchable in Settings). Each file's panel says what was replaced and what wasn't checked (for example images inside a document, or Excel cells stored as numbers).
- **Clean or restore a file by hand:** popup, **Clean a file…** or **Restore a file…**. The page cleans any supported file for use elsewhere, or puts the real values back into a file an AI produced, then offers it as a download.
- **See what was protected:** each paste reports what it replaced, by type ("5 names, 3 emails, 2 phone numbers"). The popup shows the same after a manual anonymize. The **Vault** tab keeps a running tally for the session, by type and by site, erased with the vault.
- **People are kept consistent:** once "Maria Gonzalez" is `[PERSON_1]`, a later "Maria" or "Gonzalez" on its own (in the same paste or a later one this session) also becomes `[PERSON_1]`. Restoring it shows the full name. Common-word names like "Will" or "May" are not matched on their own.
- **Read the reply:** names, companies, places and contact details in the AI's answer appear as the real values, in a fixed-width font with a dotted underline. Hover to see the placeholder the AI actually received. Card numbers and other secrets stay as placeholders on the page. Turn this off with **Show real names in AI replies** in the popup.
- **Any text box on any site:** press `Alt+Shift+A` to anonymize the box (or just the selected part).
- **Any selected text:** right-click, then **Anonymize selection** or **Restore originals in selection**.
- **Popup:** anonymize or restore text by hand, pause protection for a site, view the vault.
- **Settings:** engine, which data types to catch, which sites are protected (you can add your own, such as an internal AI portal).

## Privacy model

- **No network by default.** The built-in model (pinned to an exact revision) and its runtime ship inside the extension, and remote model loading is always switched off. If the model files are missing, the extension says so and keeps working with rules only rather than downloading anything. The only network traffic is to an Ollama endpoint, if you choose one (it defaults to `localhost`, and Settings warns you otherwise).
- **The AI site never sees real values.** The paste listener registers at `document_start`, before any page script. Revealed names in replies are drawn inside a closed shadow root: the page's DOM, its scripts, analytics and session recorders still only see `[PERSON_1]`.
- **Reveal is limited on purpose.** A page can't read a closed shadow root, but it can measure how much space the revealed text takes. So:
  - values are only revealed on the site where you pasted them (or anywhere, if you anonymized them in the popup);
  - card numbers, SSNs, IBANs, API keys, ID numbers, dates of birth and IP addresses are never revealed in the page (use the popup's **Restore** tab);
  - revealed text uses the browser's fixed-width font, which the page can't swap out, so the most a page could learn is how many characters a name has.

  If even that is too much, turn off **Show real names in AI replies**.
- **Copying a reply copies what you see.** Ctrl+C on a revealed reply puts the real values on your clipboard, while the page's own view of the selection contains neither the names nor the placeholders. A site you have explicitly allowed to read your clipboard could read it afterwards, as with anything you copy.
- Content scripts can only anonymize, restore and look up placeholders. Reading the whole vault or changing settings is limited to the extension's own pages.
- The `Origin`-removal rule for Ollama applies only to requests this extension makes, so websites can't use it to reach your local model.

### Tested on live sites

Real keyboard pastes (logged out, nothing sent) leave no sensitive value in the message box on ChatGPT, Gemini, Perplexity, Grok and Mistral. Claude, Copilot, DeepSeek and Poe need an account to reach the message box, so they are covered by the same code paths in the automated tests, but have not been checked live.

Limits: automatic detection is a safety net, not a guarantee.
- The built-in model is English-only and misses some names, especially single first names.
- Typed text is checked on Enter, Ctrl/Cmd+Enter, a Send/Submit button or a form submit. A site that sends some other way (an unlabelled icon button outside a form, a send on mouse-down) is not covered; press `Alt+Shift+A` first there.
- Text inside PDFs and images is not read. Those files are held so you can decide, not cleaned.
- Uploads made through the browser's newer file-picker API (rather than a regular file button) are not intercepted.
- Inside Office files, the following are cleaned: text, tables, headers and footers, comments, tracked deletions, field codes, link targets, slide notes, pivot-table caches and author metadata. The preview thumbnail is replaced with a blank image. Not checked (the panel lists whatever applies): images, charts, embedded files, custom XML data, Excel table column names, sheet names and formulas, and numbers stored as numbers.
- File names are cleaned when they contain a capital letter, with spaces, `_` or `-` between words ("Maria_Gonzalez_CV.docx"). Run-together names ("MariaGonzalez.txt") are not.
- With Ollama, pasted text that tries to instruct the model ("return no entities") can suppress name detection. Rules are unaffected.

Glance at the replacement panel before you send anything highly sensitive.

## Development

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run eval
```

```bash
npm run lint
```

```bash
npm run store-assets
```

- `npm test`: unit tests plus an integration test against a mock Ollama server. `npm run coverage` adds a coverage report.
- `npm run test:e2e`: loads the real extension into Playwright's Chromium and serves a fake `chatgpt.com` page, using the real built-in model. It covers:
  - pastes into a textarea, a ProseMirror-style editor, a bare `contenteditable`, a shadow-root textarea and the page background;
  - drag-and-drop, the shortcut and the right-click restore;
  - the reply reveal, including that the page DOM keeps placeholders and that values don't cross sites;
  - the per-type reports in the panel, popup and Vault tab;
  - the Ollama path, against a mock on port 11434 (stop a real Ollama first);
  - that the extension makes no outbound requests: the browser is routed through a recording proxy, and any host other than Chrome's own services fails the test.

  Set `EXTENSION_PATH` to run it against an unzipped release package.
- `npm run package`: builds the release zip in `dist/`.
- `npm run store-assets`: regenerates the Chrome Web Store screenshots and promo images in `store/images/`. Everything else needed for the store submission is in `store/`, starting with `store/SUBMISSION.md`.
- `npm run eval`: detection quality per model (`--places` toggles place names, extra args choose model IDs).

```
src/core/        pure logic: detectors, NER alignment, org rule, span resolution, vault, files (text/JSON/Office), reports, model client, settings
src/background/  service worker: message router, storage, menus, offscreen model host, DNR rule
src/offscreen/   hidden page that runs the built-in model
src/content/     paste, drop and upload interception, reply reveal, on-page panel
src/files/       page to clean or restore files by hand
src/popup/       toolbar popup
src/options/     settings page
scripts/         vendor (runtime + model), package, eval, icons
tests/           unit, integration, eval samples, real Office fixtures and e2e
vendor/          generated by npm run vendor (gitignored)
```

Third-party: [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), [distilbert-NER](https://huggingface.co/dslim/distilbert-NER) (Apache-2.0).
