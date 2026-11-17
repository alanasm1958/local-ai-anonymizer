# Chrome Web Store submission checklist

Everything the store asks for is in this folder. The steps marked **(you)** need your account, payment or judgment.

| File | Used for |
|------|----------|
| `listing.md` | Store listing tab: name, summary, description, category |
| `images/` | Icon, 5 screenshots, promo tiles (regenerate with `npm run store-assets`) |
| `privacy-policy.html` / `.md` | The privacy policy you host at a public URL |
| `permissions-and-data.md` | Privacy practices tab: single purpose, permission justifications, data usage |

## 1. Before you submit (you)

- [ ] **Use it yourself for a day** in your normal Chrome, on the AI sites you actually use.
- [ ] **Check the sites that need a login.** Live checks covered ChatGPT, Gemini, Perplexity, Grok and Mistral. Claude, Copilot, DeepSeek and Poe haven't been checked live, and the listing says the extension covers them. Check each one with a fake name, a fake card number (`4111 1111 1111 1111`) and an email address:
  - [ ] Paste with Ctrl/Cmd+V.
  - [ ] Drag text in.
  - [ ] Read a reply.

  Remove any site that misbehaves from the listing text, or tell me what broke.
- [ ] Decide the visibility:
  - **Unlisted**: only people with the link can install it. Good for colleagues first.
  - **Public**: anyone can find it in the store.
  - **Private**: limited to your Google Workspace domain or a tester group.

## 2. Developer account (you)

- [ ] Register at <https://chrome.google.com/webstore/devconsole> with the Google account you want to publish under.
- [ ] Pay the one-time $5 registration fee.
- [ ] Verify the contact email. Choose the **publisher name** shown in the store.
- [ ] Complete the **trader / non-trader** declaration (EU Digital Services Act). Choose non-trader if you are publishing for free as an individual, not as a business.

## 3. Privacy policy

- [x] Developer name (Alan Al-Jammoor) and contact email (a.s.aljammoor@gmail.com) are filled in. Use the same email as the store contact.
- [ ] Host it at a public URL. Pick one:
  - **GitHub Pages:** make the repository public, then turn on Pages (Settings > Pages, branch `main`, folder `/root`). The URL is `https://alanasm1958.github.io/local-ai-anonymizer/store/privacy-policy.html`.
  - **Separate public repo:** if you want the code to stay private, put only `privacy-policy.html` in a new public repo with Pages enabled.
  - **Google Docs:** paste the text, then File > Share > Publish to web, and use that link.
  - **Your own website**, if you have one.
- [ ] Open the URL in a private window to confirm it loads without a login.

## 4. Build the package

```bash
npm install
```

```bash
npm run package
```

This produces `dist/local-ai-anonymizer-0.5.0.zip` (about 56 MB). For every later update, raise `version` in **both** `manifest.json` and `package.json` (the package script refuses mismatched versions), then rebuild.

## 5. Fill in the dashboard

1. **Add new item** and upload the zip.
2. **Store listing tab**: copy the fields from `listing.md` and upload the images from `images/`.
3. **Privacy practices tab**: copy each answer from `permissions-and-data.md`, then paste your privacy policy URL.
4. **Distribution tab**: choose visibility (step 1) and regions (all, unless you have a reason).
5. **Test instructions** (if the dashboard shows this field), paste:

```
No account or setup is needed. After installing:
1. Open the extension's Options page and click "Test detection"; it should list a person, an organization and a place within a second.
2. Go to https://chatgpt.com (no login needed) and paste: "Email Maria Gonzalez at Northwind Traders, maria@northwind.example, card 4111 1111 1111 1111". The message box receives placeholders such as [PERSON_1] instead of the details, and a small panel lists what was replaced.
3. Open the toolbar popup, choose the Restore tab and paste "Reply to [PERSON_1]" to see the original name restored locally.
4. In the popup, click "Clean a file...", then choose any .txt or .docx file containing a name and email; the page offers a cleaned copy to download.
All processing happens in the browser; the extension makes no network requests.
```

6. **Submit for review.**

## 6. During review

- Reviews usually take a few days. Expect longer for an extension that:
  - injects into many sites;
  - requests optional access to all sites;
  - ships a large package.
- If a reviewer questions a permission, reply with the matching justification from `permissions-and-data.md`.
- If a reviewer questions the **data usage** disclosure, reply with the explanation in `permissions-and-data.md`: the data is handled on the device and never sent to the developer.

## 7. After it's published

- Every new version goes through review again.
- Keep the privacy policy URL live for as long as the extension is listed.
- Store screenshots should match the current UI; regenerate them with `npm run store-assets` after visual changes.
