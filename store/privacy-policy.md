# Local AI Anonymizer Privacy Policy

**Effective date:** October 24, 2026

Local AI Anonymizer ("the extension") is published by **Alan Al-Jammoor**. Questions about this policy: **a.s.aljammoor@gmail.com**.

## In short

The extension does not collect, store on any server, sell or share your data. It has no servers, no analytics and no tracking. All analysis happens inside your browser on your own device.

## What the extension handles, and where it stays

**Text you choose to anonymize.** This is text you paste or drag into a protected AI chat site, text you type there (checked when you press Enter or click Send, and briefly after you pause typing), text you select and anonymize with the right-click menu or the keyboard shortcut, and text you type into the extension's popup. It is analyzed on your device by pattern rules and by a small language model that ships inside the extension. It is not sent to the developer or to any third party.

**Files.** Files you attach to a protected AI chat site, or open on the extension's file page, are read and cleaned on your device in the same way, and the cleaned copy is handed to the site or offered to you as a download. Author names are removed from Office documents. The extension does not keep copies of your files.

**The placeholder list.** To show you real names in an AI's reply, the extension keeps a list that pairs each placeholder (for example `[PERSON_1]`) with the original value, plus the website it was pasted on. This list lives in your browser's session memory. It is erased when you close the browser, or immediately when you press **Clear vault**.

**Session summary.** To show what was protected, the extension counts the replacements by type and by website. These counts are kept with the placeholder list and erased with it.

**Settings.** Your preferences are saved in your browser's local extension storage on your device. These include, for example, the types of data to detect, the protected sites, the detection engine and its address, and on/off switches. The extension also stores the last number used for each placeholder type (numbers only, never the values), which stays after the browser closes so a placeholder number is never reused.

## Network activity

With the default built-in model, the extension makes no network requests. The model and the code that runs it are included in the extension package. The extension never downloads code or models at runtime.

**Optional local engine.** In Settings you can choose to use Ollama or another OpenAI-compatible server instead of the built-in model. Text you anonymize is then sent to the address you enter so that server can detect names in it. By default that address is your own computer (`localhost`). If you enter an address on another machine, Settings warns you, and your browser asks for your permission before the extension can contact it. The developer has no access to that server or its data.

## What the extension does not do

- It does not collect personal information, browsing history or website content for the developer.
- It does not use analytics, advertising, tracking or fingerprinting.
- It does not sell, rent or transfer data to anyone.
- It does not require an account.

## Permissions

The extension asks only for the browser permissions it needs to work on your device:

- storage, for the settings and session list above
- context menus and keyboard shortcuts
- access to supported AI chat sites, to anonymize text you paste there
- an offscreen page, to run the built-in model
- access to `localhost`, for the optional local engine

When you use the right-click menu or the keyboard shortcut on another site, the browser gives the extension temporary access to that one tab. Lasting access to another site is requested only when you add it in Settings, and only for that site and its subdomains.

## Limited Use

The use of information received by the extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide the extension's single purpose: removing sensitive details from text before it is shared with AI tools, and restoring them for you locally.

## Children

The extension is not directed at children under 13 and does not knowingly collect any information from anyone.

## Changes

If this policy changes, the new version will be posted at this address with a new effective date.

## Contact

**a.s.aljammoor@gmail.com**
