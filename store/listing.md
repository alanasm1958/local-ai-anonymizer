# Chrome Web Store listing

Copy each field into the Developer Dashboard, **Store listing** tab.

## Item name (max 75 characters)

```
Local AI Anonymizer
```

## Summary (max 132 characters)

```
Hide names, emails, card numbers and other private details before you paste into AI chats. Runs on your device, no cloud.
```

## Category

**Make Chrome Yours > Privacy & Security**. If that category isn't offered for your account, use **Productivity > Tools**.

## Language

English

## Description (plain text, paste as is)

```
Use AI chat tools without handing over private details.

Local AI Anonymizer replaces names, companies, email addresses, phone numbers, card numbers and other sensitive data with placeholders like [PERSON_1] the moment you paste text into an AI chat. The AI works with the placeholders. When it answers, you see the real names again, on your screen only.

Everything happens on your device. A small language model ships inside the extension, so there is no account, no cloud service and nothing extra to install.

HOW IT WORKS
• Paste or drag text into a supported AI chat. Sensitive details are swapped for placeholders before the site receives the text, and a small panel shows what was replaced.

• Type a message and press Enter or Send: the message is checked first, and anything sensitive is replaced before the site sends it. Messages with nothing to hide are sent as normal.
• The same person keeps the same placeholder, so the AI's answer still makes sense. A later mention of just "Maria" is usually matched to "Maria Gonzalez" too.
• Every paste reports what it replaced, by type (for example: 5 names, 3 emails, 2 phone numbers). The popup keeps a running tally for the session, by type and by site.
• In the AI's reply, names and contact details are shown as the real values on your screen. They are drawn outside the page's own text, so the website's scripts still see the placeholders.
• On any other site, select text and right-click, or press Alt+Shift+A in a text box.

FILES TOO
• Files you attach to a protected AI chat are cleaned before upload: text and code files, CSV, JSON, Word, Excel and PowerPoint. Formatting is kept and author names are removed from Office files.
• PDFs and images can't be checked, so the extension holds them and asks before uploading.
• Clean any file by hand for use elsewhere, or put the real names back into a file the AI produced, from the extension's popup.

WHAT IT CATCHES
• People's names, companies and organizations, cities and places (built-in model)
• Email addresses and phone numbers
• Credit card numbers and IBANs (checksum-verified, which cuts down false matches)
• US Social Security numbers, and passport, account, case and invoice numbers that follow those words
• Dates of birth after labels like "DOB" or "born on", street addresses in common English formats, UK postcodes and US state + ZIP
• IP addresses, API keys and access tokens in well-known formats, passwords written as "password: ...", and private keys
You choose which types to catch in Settings.

WORKS WITH
Automatic paste protection covers ChatGPT, Claude, Gemini, Microsoft Copilot, Perplexity, DeepSeek, Mistral Le Chat, Grok and Poe. You can add other sites, such as an internal AI portal, in Settings.

PRIVACY BY DESIGN
• No data leaves your device. The extension has no server, no analytics and no tracking.
• The list of placeholders and their real values is kept in memory only and is erased when you close the browser, or sooner with one click.
• Revealed names in replies are kept out of the page's own text, so the AI website's scripts still see only the placeholders.
• Card numbers, account numbers and other secrets are never put back into the AI's replies on screen.
• Copy part of a reply with Ctrl/Cmd+C and the copy has the real details, ready for your email or document. They go to your clipboard only; the website never sees the copy.

OPTIONAL: A STRONGER MODEL
If you already run Ollama or LM Studio on your computer, you can switch the detection engine to it in Settings for broader coverage. By default it talks only to your own computer.

GOOD TO KNOW
• Automatic detection is a safety net, not a guarantee. Glance at the replacement panel before sending anything highly sensitive.
• The built-in model is English-only.
• Typed text is checked when you press Enter or click a Send button. Sites that send another way (for example a button with no label) may not be covered; press Alt+Shift+A first to be sure.

Not affiliated with or endorsed by OpenAI, Anthropic, Google, Microsoft, Perplexity, DeepSeek, Mistral AI, xAI or Quora.
```

## Images

All in `store/images/` (regenerate with `npm run store-assets`):

| Field | File | Size |
|-------|------|------|
| Store icon | `store-icon-128.png` | 128 x 128 |
| Screenshot 1 | `1-paste.png` | 1280 x 800 |
| Screenshot 2 | `2-reveal.png` | 1280 x 800 |
| Screenshot 3 | `3-on-device.png` | 1280 x 800 |
| Screenshot 4 | `4-popup.png` | 1280 x 800 |
| Screenshot 5 | `5-files.png` | 1280 x 800 |
| Small promo tile | `promo-small-440x280.png` | 440 x 280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400 x 560 |

All screenshots use a neutral chat page and fictional people, companies and numbers.

## Additional fields

- **Official URL:** leave empty unless you own a verified site for it.
- **Homepage URL:** the GitHub repository if you make it public, otherwise leave empty.
- **Support URL:** an email link or the repository's Issues page.
- **Mature content:** No.
