# Privacy practices tab: answers to paste

These are the Developer Dashboard **Privacy practices** fields, in order. Each answer was checked against the code in v0.5.0 (`manifest.json`, `src/background/`, `src/content/`, `src/offscreen/`).

## Single purpose description

```
Removes sensitive details (names, contact details, card and account numbers, secrets) from text and files before the user shares them with AI chat tools, by replacing them with placeholders, and restores the real values in the AI's reply on the user's screen only. All detection runs locally in the browser.
```

## Permission justifications

### storage

```
Saves the user's settings in chrome.storage.local (for example which data types to detect, protected sites, detection engine and on/off switches), plus the last number used for each placeholder type (numbers only, kept so placeholder numbers are never reused). Keeps the session list that maps placeholders such as [PERSON_1] back to the original values, and per-type counts for the session summary, in chrome.storage.session, which is memory-only and cleared when the browser closes or the user clears it. Nothing is synced or sent anywhere.
```

### contextMenus

```
Adds two items to the right-click menu for selected text: "Anonymize selection" and "Restore originals in selection". These let the user clean or restore text on any page, not only on the AI sites the extension protects automatically.
```

### activeTab

```
Used only when the user clicks the extension's right-click menu item or presses its keyboard shortcut (Alt+Shift+A) on a page that is not one of the protected AI sites. It gives one-time access to that tab so the extension can read the user's selection or text box and replace it with the anonymized version. The popup also uses it to show whether protection is on for the current site.
```

### scripting

```
Two uses, both on the user's request: (1) when the user adds their own site (for example an internal AI portal) in Settings and grants access, the extension registers its content script for that site with chrome.scripting.registerContentScripts; (2) when the user invokes the right-click menu or keyboard shortcut on a tab where the content script is not loaded, it injects the extension's own bundled content script into that tab with chrome.scripting.executeScript under activeTab. No remote or dynamically generated code is ever injected.
```

### offscreen

```
Creates one offscreen document that runs the bundled named-entity recognition model (DistilBERT, ONNX, executed with WebAssembly via Transformers.js). The model cannot run in the MV3 service worker because ONNX Runtime needs dynamic module import, which service workers do not allow. The document only analyzes text the user asked to anonymize, makes no network requests, and closes itself after 10 minutes of inactivity. The reason given is WORKERS, the closest of Chrome's allowed reasons for running a compute model; it runs single-threaded WebAssembly.
```

### declarativeNetRequest

```
Used for one dynamic rule that removes the Origin header from requests the extension itself sends to the user's own local model server (Ollama on localhost), because Ollama rejects requests with a chrome-extension:// origin. The rule matches only requests whose initiator is this extension (initiatorDomains set to the extension's own ID) and whose destination is the configured model host (requestDomains), so it never affects requests made by websites. It is kept in place whatever engine is selected, but only ever matches the extension's own requests to that host. It does not block, redirect or modify any other traffic.
```

### Host permission: http://localhost/*, http://127.0.0.1/*, https://localhost/*, https://127.0.0.1/*

```
Lets the extension contact a local model server on the user's own computer (Ollama or LM Studio) when the user chooses that optional detection engine in Settings. These addresses never leave the user's machine. With the default built-in model these permissions are not used.
```

### Optional host permissions: https://*/*, http://*/*

```
Requested at runtime only when the user explicitly adds a site to protect (for example ai.mycompany.com) or points the optional detection engine at a server on another machine. The browser shows its permission prompt for that site and its subdomains only. Nothing is requested at install time, and the user can remove a site at any time, which also removes the permission.
```

### Content scripts (if asked about the matched sites)

```
The content script runs on the AI chat sites listed in the manifest (chatgpt.com, chat.openai.com, claude.ai, gemini.google.com, copilot.microsoft.com, perplexity.ai, chat.deepseek.com, chat.mistral.ai, grok.com, poe.com). It intercepts paste, drop and file-upload events, and holds Enter and Send when typed text contains sensitive data, so text and supported files can be anonymized on the device before the site receives them, and shows the real values in the AI's reply on the user's screen. It looks for placeholders such as [PERSON_1] in the page only to display them, and never sends page content off the device.
```

### Content Security Policy: 'wasm-unsafe-eval' (if asked)

```
Required to compile the bundled ONNX Runtime WebAssembly module that runs the local model. All WebAssembly and JavaScript ships inside the extension package; nothing is fetched or evaluated from remote sources.
```

## Remote code

Answer: **No, I am not using remote code.**

```
All JavaScript and WebAssembly is included in the package, including Transformers.js, ONNX Runtime Web and the model weights. Remote model loading is disabled in code (env.allowRemoteModels = false), and the WebAssembly path points at the packaged files. The bundled Transformers.js library contains default URLs for cdn.jsdelivr.net and huggingface.co; both are overridden at startup and never contacted, which the extension's automated tests check by routing the browser through a recording proxy.
```

## Data usage

**Recommended: disclose what the extension handles, even though it stays on the device.** The extension never sends data to the developer. But the whole point of it is to process pasted text containing personal, financial and login details. With the optional engine, that text can also go to a server the user configures. Disclosing avoids a rejection for under-reporting, and it's the more defensible reading of the policy.

Check these data types:

- [x] **Personally identifiable information** (names, emails, phone numbers, addresses, ID numbers in pasted text)
- [x] **Financial and payment information** (card numbers and IBANs in pasted text)
- [x] **Authentication information** (passwords, API keys and tokens in pasted text)
- [x] **Website content** (the text and files the user pastes, drops, types or uploads into AI chat sites)

If asked for details, use:

```
All of this data is text the user chooses to anonymize. It is processed only on the user's device, by rules and a model bundled in the extension, and the mapping of placeholders to original values is kept in session memory and erased when the browser closes. Nothing is sent to the developer or any third party. The only exception is optional and user-configured: if the user selects their own Ollama or OpenAI-compatible server (by default on localhost), text is sent to that server for detection.
```

Your store listing will then show these categories under "Privacy". The listing description and privacy policy explain that the data stays on the device.

The alternative is to leave every type unchecked, on the reading that nothing is "collected" by the developer. That's arguable, but riskier at review.

Then tick all three certifications. They are true for this extension:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

The URL where you host `store/privacy-policy.html` (see `SUBMISSION.md`, step 3).
