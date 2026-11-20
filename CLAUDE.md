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
| `src/content/toast.js` | On-page panel in a closed shadow root, exposed as `globalThis.__anonymizerToast`. Loaded first. |
| `src/content/reveal.js` | Loaded before content.js (shared isolated world, exposed as `globalThis.__anonymizerReveal`). Shows real values in replies via spans whose visible text is in a CLOSED shadow root; the page DOM keeps the placeholder. Never touches editable elements. |
| `src/core/files.js` | Anonymize/restore whole files: classify by extension, text and JSON handlers, Office via `ooxml.js`, file names. Returns `unsupported` with a reason instead of passing unknown formats through. |
| `src/core/ooxml.js` | Office XML text engine (regex scan, no DOMParser so it runs in the worker): text in document order across split runs, `rewriteSegments` puts each replacement in the first run it touches, metadata/author clearing, notes for what isn't checked. |
| `src/core/orgs.js` | Rule-based organizations ("X Traders", "Y Ltd") for when the model misses one at a sentence start; follows the model switch and ORGANIZATION type. |
| `src/content/send-guard.js` | Clean on send, loaded before content.js (`globalThis.__anonymizerSendGuard`). Holds a trusted Enter/Ctrl+Enter, Send-labelled or submit button click, or form submit when the typed text is not known safe; anonymizes the box, then replays (synthetic Enter, `button.click()`, `requestSubmit`). A replayed Enter the site ignores gets the key's default (newline or form submit). Background `scan` (worker, read-only, no vault writes) after 500 ms idle marks clean text so it passes as the real event. Setting `checkTyping`. |
| `src/content/copy-restore.js` | Copy with real details, loaded before content.js (`globalThis.__anonymizerCopyRestore`). Trusted copy of reply text with placeholders (not in a text box): window capture listener stops the event before page listeners, sets the placeholder text, then the worker's `copyOriginals` (`originalsForCopy`: every type, this site only, max 500) fills it and `navigator.clipboard.write` writes plain + HTML (values HTML-escaped). Toast shows a count, never values. Setting `restoreOnCopy`. Site Copy buttons are not covered. |
| `src/content/uploads.js` | Upload guard: file inputs (stops input/change, clears the input, re-fires with cleaned files), file paste/drop; holds unsupported files. Messages carry the MIME type as `mime` because `type` is the handler name. |
| `src/help/` + `src/core/welcome.js` | "How to use" guide for non-technical staff. Linked first in the popup footer; opens by itself on a fresh install only when `installType` is `admin` (IT policy) or `normal` (store), never for unpacked copies (keeps e2e tabs clean). |
| `it/` + `scripts/it-bundle.mjs` | Handoff to Amideast IT: install guide (HTML rendered to PDF), email draft. `npm run it-bundle` (after `npm run package`) writes `dist/Amideast IT package <version>/` and `dist/Amideast-IT-package-<version>.zip`. |
| `src/files/` | Clean or restore files by hand (a page, because popups close when a file picker opens). |
| `tests/fixtures/` | Real .docx/.xlsx/.pptx from python-docx, openpyxl, python-pptx, LibreOffice and textutil (`make-fixtures.py`). |
| `src/core/report.js` | Per-run summary by type (`summarizeReplacements`, `formatBreakdown`) and the session tally (`sessionTally`). The worker attaches `summary` to every anonymize result and keeps run/mention counts in `storage.session` (`stats`), cleared with the vault. |
| `src/core/normalize.js` | `detectionView`: the copy detection reads (plain digits, no invisible characters) and `toOriginal` to map spans back. |
| `src/core/phone-plans.js` | Numbering plans for 18 MENA countries; `fitsRegionalPlan` is the exact phone check. |
| `src/core/name-parts.js` | Completes half-found names after the model (MISC as person, neighbours, particles, company tails). Called from `alignTokens` when `isKnownWord` is passed. |
| `src/core/columns.js` | `columnSpans`: cells under a table header that names IDs or phones (cin, passport, civil ID, phone, رقم الهاتف...) are IDs/phones in CSV, TSV and markdown. Called from `detectPatterns`. Found live: a second-row CIN leaked. `columnPlaces`: cells under city/country/location headers; `anonymize` relabels a model person/company with that text (vault values too) as LOCATION (live: "Rabat" as a person). `placeCells`: those cells are also hidden as LOCATION when the model misses them ("Rabat" LOC 0.50 in an Office table), except filler (n/a, Remote, Online) and anything with digits; follows `useModel` and the LOCATION type. |
| `src/core/xlsx-grid.js` | `sharedStringGrid`: Excel shared strings laid out as the sheets show them (rows of tab-separated cells, padded to the widest row) so column rules and the model see real rows. A string's segments sit at its first use; unused strings follow. Found live: every CIN in an .xlsx was sent as typed with a fresh vault. |
| `src/core/names.js` | Lone first/last names of known full names get the full name's placeholder (`span.aliasOf`). `COMMON_WORD_NAMES` guards words like Will/May. |
| `src/core/ner.js` | Model id/constants, `alignTokens` (word pieces with no offsets back to text spans), `detectWithModel` (chunking; CSV/TSV rows read one at a time). Stoplist `NEVER_ENTITIES`. |
| `src/core/truecase.js` | The model is cased, so lowercase and ALL CAPS names were missed. The model reads a copy where shouted lines are lowered and lowercase words missing from its own vocabulary (`tokenizer.get_vocab()`) get a capital; same length, so entities are cut from the original text. `SHORTHAND` keeps chat/tech words (thx, json) as typed. |
| `tests/scenarios/` + `scripts/scenarios.mjs` + `tests/e2e/scenarios.e2e.js` | 50-case scenario package (names in every casing, data types, tables/CSV/JSON/code/diagrams, channels: paste, drop, typing, shortcut, selection, uploads, reveal). `npm run scenarios` runs the text cases through the pipeline in Node; `npm run test:scenarios` delivers every case through its channel in the real extension. `known`/`knownMiss` mark documented gaps. |
| `tests/stress/` + `scripts/stress.mjs` | MENA stress suite (3,501 seeded cases: 14 countries' phones, IDs, IBANs, names in every casing, 17 contexts, Unicode traps). Strict oracle (`oracle.js`): partial leaks count (one surname, any 4 digits), case and digit script ignored. Scope decisions in `policy.js`. `npm run stress` writes `test-results/stress-<date>.csv/.json`; summary in `test-results/REPORT.md`. Users are Amideast staff across MENA, not only Iraq. |
| `src/offscreen/` | Hidden page that runs Transformers.js (the MV3 worker can't: no dynamic `import()`). Only answers messages with `target: 'offscreen'`. Closes itself after 10 idle minutes. |
| `src/background/builtin.js` | Creates the offscreen doc, retries while its listener registers, exposes `builtinClient.detectEntities`. |
| `scripts/vendor.mjs` | Copies `transformers.min.js` (self-contained build; the `.web` build has bare imports) and ORT `asyncify` wasm into `vendor/`, downloads the model. Runs on `npm install`. `vendor/` is gitignored. |
| `scripts/eval-ner.mjs` + `tests/eval/samples.js` | Detection-quality eval in Node (`npm run eval`). |
| `store/` | Chrome Web Store submission: listing, privacy policy (md + html), permission and data-use answers, checklist, images (`npm run store-assets` via `scripts/store-assets.mjs`). Claims there must stay true to the code; re-check after behavior changes. |
| `scripts/package.mjs` | Builds `dist/local-ai-anonymizer-<version>.zip` (manifest, icons, src, vendor) with fflate and fixed timestamps. Fails if manifest and package.json versions differ. |
| `.github/workflows/ci.yml` | Windows + macOS: lint, unit, e2e, package, e2e against the extracted zip. |
| `src/background/state.js` | Settings (`storage.local`), vault (`storage.session`), vault mutex, worker keep-alive |
| `src/background/integrations.js` | Dynamic DNR rule that strips `Origin` on requests to the model host (scoped to `initiatorDomains: [extension id]` so pages cannot abuse it), custom-site content script registration, badge |
| `src/popup/` | Manual anonymize / restore UI and on/off toggle |
| `src/options/` | Endpoint, model, entity types, sites |
| `src/ui/` | Shared theme CSS and messaging helpers for extension pages |
| `tests/helpers/extension-browser.js` | Shared e2e launcher (unpacked extension, recording proxy, routed fake page). |
| `tests/` | `*.test.js`: unit + mock-Ollama integration. `tests/e2e/*.e2e.js`: Playwright loads the real extension, fakes chatgpt.com via `context.route`, mock Ollama on :11434 |

## Key design rules

- Placeholders look like `[PERSON_1]`. The vault (placeholder to original mapping) lives in `chrome.storage.session` only, so it is wiped when the browser closes.
- The vault is immutable: every core function returns a new vault object.
- Regex (validated) spans win over LLM spans when they overlap; longer spans win over shorter ones.
- If the local model fails, fall back to pattern-only detection and tell the user in the toast (configurable to cancel the paste instead).
- Content script runs at `document_start` so its window capture-phase paste and drop listeners are registered before any page script.
- Every text paste on a protected site is intercepted, not just pastes into text boxes: sites like chat.mistral.ai route page-wide pastes into the composer. Non-editable targets get the anonymized text re-dispatched as a synthetic event.
- Gemini uses Quill 1.x, which mishandles synthetic paste; `.ql-editor` targets are filled with execCommand line by line.
- Typed text: never hold Shift+Enter or IME composition; only trusted events are held (page-dispatched events carry nothing the page lacks). Send buttons without a Send/Submit label outside a form are not detected; live-check each site after changes.
- Claude's browser tools cannot press Chrome extension shortcuts (Alt/Option+Shift+A arrives as a letter) or open chrome://extensions; ask the user for that keypress and for reloads.
- Live-site checks use real keyboard pastes (clipboard + Ctrl/Cmd+V); synthetic paste tests missed the Mistral leak.
- Drop interception skips only trusted drags that started inside a text box on the page and carry exactly the dragged text (`pageDrag`); never trust untrusted dragstart/dragend.
- Paste/drop text comes from `transferText`: text/plain, else text/html via inert DOMParser, else text/uri-list. Non-text form fields (password, number, date) return before reading the clipboard.
- Name parts (`span.aliasOf`, source `alias`) rank below model spans; known vault values skip values under 3 chars and `NEVER_ENTITIES`, and only apply when `useModel` is on.
- about:blank and srcdoc frames have no hostname: the content script uses the inherited or ancestor origin (`siteHostname`) and the worker falls back to `sender.origin`, then the tab URL. Otherwise iframe editors switch protection off.
- Capitals are judged per segment: a whole text, a line, or (in a line with | , ; : or tab) one cell with 2+ capital words. Found live on ChatGPT: "| OMAR FAROUK | omar@x |" sent "FAROUK". CSV rows (tab or comma with no space after, same field count as a neighbour) are read one at a time even after a plain intro line (live: "Wei Zhang" leaked). The stoplist check ignores case (`isNeverEntity`).
- Live checks: judge every word of every value on its own, not whole phrases (a phrase check passed "[ORGANIZATION_2] FAROUK").
- Phone numbers: exact check first against `phone-plans.js` (18 MENA countries: local with trunk 0, no-trunk 8-digit Gulf/Tunisia numbers, +cc, 00cc, +cc (0)); a bare 8-digit run needs a separator to count. Otherwise the generic rule: 9-15 digits with formatting or 10+ without; "555-1234" counts; after a phone word (English or Arabic: هاتف، جوال، رقم...) 6 to 15 digits count. IPv4-shaped and date-shaped runs never count.
- Detection reads a copy (`normalize.js` `detectionView`): Arabic-Indic, Persian, full-width digits made plain, zero-width and bidi characters removed, odd spaces made plain. Spans map back with `toOriginal` and take their value from the original, so restore is byte-exact.
- IDs after a keyword may be lowercase only as up to 3 letters + 4 digits ("a39573324", "cr-656436"); "python3", "handbook2024" must stay. Arabic ID and DOB keywords have no `\b` (JS word boundaries are ASCII only).
- Name completion (`name-parts.js`, on when the vocabulary is passed): MISC groups of 2+ unknown capitalized words are people (one word alone never: "EGP", "Brochures"; stoplisted words block: "Excel Formulas"); a capitalized neighbour joins a person when unknown to the vocabulary in lowercase or labelled by the model (months/days never; confident ORG/LOC block); "Surname, First" only when the pair ends the phrase (else the comma neighbour becomes its own person; pronouns never join; never across a comma into another found entity); Al-/El- particles and hyphen tails; LOC/ORG + company word ("Nile valley trading co.") is one confident organization, and so is a phrase ending in a company word that contains a proper noun ("carthage textiles"). A proper noun after a person label (name, contact, owner, student, assigned...: `fieldNames`) is a person; a person already found there is confirmed, not cut short. The model also reads curly quotes as straight ones; names never start on a title's dot. ID keywords (CIN, iqama...) are stoplisted: the vault reuses any mis-tag for the whole session (found live). Single proper nouns get the 0.45 bar.
- The model reads a copy truecased once for the whole text (so an ALL CAPS table is lowered even though rows are read one at a time), with table pipes as spaces ("| Contact | Maya Khoury |" read Maya as ORG 0.60, without pipes PER 0.96). Truecasing: Unicode capitals ("BÊRIVAN"), runs of 2+ capital words inside a normal line unless all are vocabulary acronyms, flipped case ("gEoRgEs"), "el-sayed", initials ("t. odeh"); exam names (toefl, ielts...) stay as typed.
- One name in different casings shares one placeholder: a non-person entity whose text matches a person entity (case-insensitive) becomes a person (`preferPerson`).
- Known gaps (tracked in the scenario package): names in Arabic script; URLs are off by default; handles like @omar.f and profile links without https.
- minimum_chrome_version 128 (caretPositionFromPoint, matchOriginAsFallback).
- NER: a different-type I- token joins a person group only when both are below NER_MIN_SCORE and separated by one space (`unsureSurname`); no entity spans a line break; the multi-word person threshold (0.45) is judged after trimming greeting/command words; a lone command/greeting word is never a name. Fixtures in tests/ner.test.js are captured from the real model.
- Office tables read like a TSV: Word (`w:tc`/`w:tr`), PowerPoint (`a:tc`/`a:tr`) and inline sheet cells (`c`/`row`) give "\t" per cell and "\n" per row (`tableBreaks`; only tags may sit between a paragraph end and the cell end, never text or another cell's start). `rewriteSegments` accepts segments in any text order.
- Office engine: `OOXML_RULES` lists text rules (element text, e.g. w:t, w:delText, w:instrText) and attribute rules (pivot cache `<s v>`, external link targets); every matching rule runs on a part. CDATA in a processed part makes the file unsupported (fail safe). Gap notes are only added when cleaning, not restoring.
- JSON is edited in place on the raw text (string tokens only), never re-serialized: numbers like 12345678901234567890 must survive byte for byte.
- Content script state starts protected (fail closed) and stays protected if the worker can't be reached; only a removed/reloaded extension (no `chrome.runtime.id`) turns it off.
- Never test file uploads on live AI sites without the user's go-ahead: unlike pasting into a box, an upload sends the file to that company's servers.
- e2e routes the browser through `tests/helpers/recording-proxy.js`; Playwright forces loopback through any proxy unless localhost is in the bypass list.
- Look follows the organization's brand without its name or logo: two primary blues (#283A97 dark, #00A1E4 light) plus gold #FDC20F as the one secondary accent (May 2021 color guide); green/red only as status colors. Extension pages use bundled Montserrat (`src/ui/fonts/`, OFL); the on-page panel (toast.js) keeps the system font because a font file would have to be web-accessible, which lets pages detect the extension. Icons from `scripts/make-icons.py`, store art from `npm run store-assets`.
- Name particles that are English words (at, as, ad, ed) join a name only with a hyphen ("at-Tahir"); with a space "Rashid at Gulf Petro Services" swallowed "Gulf" and sent "Petro Services" (found 2026-11-20).
- `[hidden] { display: none !important }` in `src/ui/theme.css` is load-bearing: component `display` rules otherwise override `hidden`.
- No em dashes in copy or docs (user preference).
- Cross-platform (Windows CI runs every change): npm script globs use escaped double quotes (cmd.exe keeps single quotes literally); no shell tools in scripts (packaging and extraction use fflate); zip entry names use "/"; `.gitattributes` forces LF; performance tests use `budget(ms)` from `tests/helpers/timing.js` (4x on CI).
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
npm run scenarios   # 50-case scenario package, text cases through the pipeline (real model, Node)
npm run stress      # MENA stress suite, 3,501 cases, real model in Node (~30 s)
node scripts/ner-debug.mjs "text"   # what the model reads, its raw tokens, and the anonymized output
npm run test:scenarios  # same package delivered through every channel in the real extension (also part of test:e2e)
npm run lint        # ESLint (flat config; content scripts are classic scripts)
npm run it-bundle   # IT handoff folder + zip (extension zip, staff guide PDF, IT guide PDF); run after package
npm run package     # release zip in dist/, reproducible (EXTENSION_PATH=<unzipped> npm run test:e2e to check it)
node scripts/extract-zip.mjs <dir>   # extract the release zip (any OS)
python3 scripts/make-icons.py   # regenerate icons/
```

No build step. Load the folder unpacked at `chrome://extensions`.
