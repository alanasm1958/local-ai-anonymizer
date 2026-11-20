// Generates Chrome Web Store images into store/images/: five 1280x800
// screenshots, the 440x280 small promo tile, the 1400x560 marquee and a
// 128x128 store icon. The extension runs for real (built-in model included)
// on a neutral, unbranded chat page with fictional data.
// Usage: node scripts/store-assets.mjs   (needs vendor/ from npm run vendor)

import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store', 'images');
const CHAT_URL = 'https://chatgpt.com/'; // a protected host; the page itself is generic

const SAMPLE = 'Please draft a polite reply to Ahmed Al-Rashid at Gulf Petro Services (ahmed.alrashid@gulfpetro.example, +44 20 7946 0958).\nHis card 4111 1111 1111 1111 was charged twice for invoice INV-2024-00871.';

const CHAT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #ffffff; }
  header { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 22px; border-bottom: 1px solid #eceef1; font-weight: 600; }
  header i { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: inline-block; }
  main { max-width: 760px; margin: 0 auto; padding: 26px 22px 160px; display: grid; gap: 18px; }
  .user { justify-self: end; max-width: 82%; background: #f2f3f5; border-radius: 16px; padding: 11px 15px; white-space: pre-wrap; }
  .bot { display: grid; grid-template-columns: 30px 1fr; gap: 12px; }
  .bot i { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6); }
  #reply p { margin: 0 0 10px; }
  .composer { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(760px, calc(100% - 44px)); border: 1px solid #dfe2e6; border-radius: 22px; padding: 14px 18px 46px; box-shadow: 0 4px 18px rgba(0,0,0,.06); background: #fff; }
  #composer { min-height: 26px; outline: none; white-space: pre-wrap; }
  #composer:empty::before { content: "Message the assistant"; color: #8b929a; }
  .send { position: absolute; right: 12px; bottom: 10px; width: 32px; height: 32px; border-radius: 50%; background: #1f2328; }
  /* Paste shot: message box on the left so the extension's panel doesn't cover it. */
  body.compact .composer { left: 22px; transform: none; width: 520px; }
</style></head><body>
  <header><i></i>AI Assistant</header>
  <main id="thread"></main>
  <div class="composer"><div id="composer" contenteditable="true"></div><input id="attach" type="file" multiple hidden><span class="send"></span></div>
  <script>
    if (location.search.includes('compact')) document.body.classList.add('compact');
    window.firePaste = (text) => {
      const el = document.getElementById('composer');
      el.focus();
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true, composed: true }));
    };
    window.addTurn = (userText, replyParas) => {
      const thread = document.getElementById('thread');
      const user = document.createElement('div'); user.className = 'user'; user.textContent = userText;
      const bot = document.createElement('div'); bot.className = 'bot';
      const avatar = document.createElement('i');
      const reply = document.createElement('div'); reply.id = 'reply';
      replyParas.forEach((t) => { const p = document.createElement('p'); p.textContent = t; reply.append(p); });
      bot.append(avatar, reply);
      thread.append(user, bot);
    };
  </script>
</body></html>`;

const asDataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

async function launch() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'anonymizer-store-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await context.route(`${CHAT_URL}**`, (route) => route.fulfill({ contentType: 'text/html', body: CHAT_PAGE }));
  return { context, worker, userDataDir, extensionUrl: (path) => `chrome-extension://${new URL(worker.url()).host}/${path}` };
}

async function capturePaste(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 920, height: 420 });
  await page.goto(`${CHAT_URL}?compact`);
  await page.waitForTimeout(800);
  await page.evaluate((t) => window.firePaste(t), SAMPLE);
  await page.waitForFunction(() => document.getElementById('composer').textContent.includes('[PERSON_1]'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const shot = await page.screenshot();
  const sent = await page.evaluate(() => document.getElementById('composer').innerText);
  await page.close();
  return { shot, sent };
}

async function captureReveal(context, sent) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(CHAT_URL);
  await page.waitForTimeout(800);
  const person = sent.match(/\[PERSON_\d+\]/)[0];
  const org = sent.match(/\[ORGANIZATION_\d+\]/)[0];
  const email = sent.match(/\[EMAIL_\d+\]/)[0];
  await page.evaluate(({ user, paras }) => window.addTurn(user, paras), {
    user: sent,
    paras: [
      `Dear ${person},`,
      `Thank you for letting us know about the duplicate charge on behalf of ${org}. I have confirmed that your card was billed twice, and the second payment has been refunded.`,
      `A confirmation will follow at ${email} within two business days. Please accept our apologies for the inconvenience.`,
    ],
  });
  await page.waitForTimeout(900);
  const shot = await page.screenshot();
  await page.close();
  return shot;
}

async function captureFiles(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 920, height: 420 });
  await page.goto(`${CHAT_URL}?compact`);
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.getElementById('composer').textContent = 'Summarize the attached refund letter and call notes.'; });
  await page.setInputFiles('#attach', [
    { name: 'Refund letter.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await readFile(join(ROOT, 'tests', 'fixtures', 'python-docx.docx')) },
    { name: 'Call notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Spoke with Ahmed Al-Rashid (+44 20 7946 0958) about the duplicate charge.') },
  ]);
  await page.waitForTimeout(2500);
  const shot = await page.screenshot();
  await page.close();
  return shot;
}

async function capturePopup(context, extensionUrl) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(extensionUrl('src/popup/popup.html'));
  await page.fill('#anon-input', 'Call Priya Raman at Tata Consultancy Services on +91 98450 12345 about passport no. B7731902.');
  await page.click('#anon-run');
  await page.waitForSelector('#anon-result:not([hidden])');
  await page.click('[data-tab="vault"]');
  await page.waitForSelector('#tally:not([hidden])');
  await page.waitForTimeout(1200);
  const shot = await page.screenshot({ fullPage: true });
  await page.close();
  return shot;
}

async function captureOptions(context, extensionUrl) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 860, height: 1200 });
  await page.goto(extensionUrl('src/options/options.html'));
  await page.click('#test-model');
  await page.waitForSelector('#test-result:not([hidden])');
  await page.waitForTimeout(600);
  const model = await page.locator('#model-card').screenshot();
  const types = await page.locator('.card').nth(1).screenshot();
  await page.close();
  return { model, types };
}

// Brand palette (same values as src/ui/theme.css) and the bundled Montserrat font.
const BRAND = { dark: '#283a97', light: '#00a1e4', gold: '#fdc20f', text: '#1a1d33', muted: '#5b6280' };
const FONT_FACE = `@font-face { font-family: "Montserrat"; font-weight: 100 900;
  src: url(data:font/woff2;base64,${(await readFile(new URL('../src/ui/fonts/montserrat-latin-variable.woff2', import.meta.url))).toString('base64')}) format("woff2"); }`;
const FONT_STACK = '"Montserrat", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const FRAME_CSS = `
  ${FONT_FACE}
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; font-family: ${FONT_STACK};
    background: radial-gradient(1200px 700px at 85% 20%, #e0f3fc 0%, #eef1f9 45%, #f4f6fb 100%); color: ${BRAND.text}; }
  .wrap { display: grid; grid-template-columns: 400px 1fr; gap: 48px; align-items: center; height: 100%; padding: 0 64px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; color: ${BRAND.dark}; margin-bottom: 26px; font-size: 17px; }
  .brand img { width: 30px; height: 30px; }
  h1 { font-size: 42px; line-height: 1.15; letter-spacing: -0.01em; margin-bottom: 20px; color: ${BRAND.dark}; font-weight: 800; }
  h1::after { content: ""; display: block; width: 64px; height: 5px; border-radius: 3px; background: ${BRAND.gold}; margin-top: 18px; }
  p { font-size: 20px; line-height: 1.5; color: ${BRAND.muted}; }
  .shot { justify-self: center; display: flex; justify-content: center; align-items: center; max-height: 680px; }
  .shot img { display: block; max-width: 100%; max-height: 680px; border-radius: 14px; box-shadow: 0 24px 60px rgba(26, 29, 51, .18), 0 0 0 1px rgba(26, 29, 51, .06); }
`;

async function composeFrame(page, { title, text, image, iconUrl, maxWidth = 740 }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}
    .shot img { max-width: ${maxWidth}px; }</style></head><body><div class="wrap">
    <div><div class="brand"><img src="${iconUrl}" alt="">Local AI Anonymizer</div><h1>${title}</h1><p>${text}</p></div>
    <div class="shot"><img src="${image}" alt=""></div></div></body></html>`);
  await page.waitForTimeout(150);
  return page.screenshot({ type: 'png', scale: 'css' });
}

async function composeTile(page, { width, height, iconUrl, title, tagline, titleSize, taglineSize, iconSize }) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    ${FONT_FACE}
    * { margin: 0; box-sizing: border-box; }
    body { width: ${width}px; height: ${height}px; overflow: hidden; display: flex; align-items: center; gap: ${Math.round(iconSize * 0.3)}px;
      padding: 0 ${Math.round(width * 0.08)}px; font-family: ${FONT_STACK};
      background: linear-gradient(135deg, #ffffff 0%, #eef1f9 55%, #e0f3fc 100%); color: ${BRAND.dark};
      border-bottom: ${Math.max(4, Math.round(height * 0.02))}px solid ${BRAND.light}; }
    img { width: ${iconSize}px; height: ${iconSize}px; filter: drop-shadow(0 8px 18px rgba(40,58,151,.25)); flex: none; }
    h1 { font-size: ${titleSize}px; line-height: 1.1; letter-spacing: -0.01em; font-weight: 800; }
    h1::after { content: ""; display: block; width: 18%; height: ${Math.max(3, Math.round(titleSize * 0.09))}px; border-radius: 3px; background: ${BRAND.gold}; margin-top: ${Math.round(titleSize * 0.3)}px; }
    p { font-size: ${taglineSize}px; line-height: 1.35; color: ${BRAND.muted}; margin-top: 10px; }
  </style></head><body><img src="${iconUrl}" alt=""><div><h1>${title}</h1><p>${tagline}</p></div></body></html>`);
  await page.waitForTimeout(150);
  return page.screenshot({ type: 'png', scale: 'css' });
}

// Store guidance: 128x128 with the artwork in the central 96x96.
async function composeStoreIcon(page, iconUrl) {
  await page.setViewportSize({ width: 128, height: 128 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:128px;height:128px;display:flex;align-items:center;justify-content:center;background:transparent">
    <img src="${iconUrl}" style="width:96px;height:96px" alt=""></body></html>`);
  return page.screenshot({ type: 'png', omitBackground: true, scale: 'css' });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { context, userDataDir, extensionUrl } = await launch();
  try {
    const iconUrl = asDataUrl(await readFile(join(ROOT, 'icons', 'icon-128.png')));
    const paste = await capturePaste(context);
    const reveal = await captureReveal(context, paste.sent);
    const popup = await capturePopup(context, extensionUrl);
    const options = await captureOptions(context, extensionUrl);
    const files = await captureFiles(context);

    const composer = await context.newPage();
    const { writeFile } = await import('node:fs/promises');
    const frames = [
      ['1-paste.png', 'Sensitive details never reach the AI', 'Names, companies, emails, phone and card numbers are swapped for placeholders the moment you paste.', paste.shot],
      ['2-reveal.png', 'Read the reply with the real names', 'Names and contact details in the answer appear as the real values, on your screen only. Card numbers stay hidden.', reveal],
      ['3-on-device.png', 'Runs on your device', 'A small model is built in. No account, no cloud service, nothing extra to install.', options.model],
      ['4-popup.png', 'See exactly what was protected', 'Every paste reports what it replaced, by type. The popup keeps a running tally by type and site, erased when you close the browser.', popup, 340],
      ['5-files.png', 'Files are cleaned too', 'Word, Excel, PowerPoint, CSV, JSON and text files are cleaned before upload. PDFs and images wait for your OK.', files],
    ];
    for (const [name, title, text, buffer, maxWidth] of frames) {
      await writeFile(join(OUT, name), await composeFrame(composer, { title, text, image: asDataUrl(buffer), iconUrl, maxWidth }));
      console.log(`wrote store/images/${name}`);
    }
    await composer.setViewportSize({ width: 440, height: 280 });
    await writeFile(join(OUT, 'promo-small-440x280.png'), await composeTile(composer, {
      width: 440, height: 280, iconUrl, iconSize: 84, titleSize: 30, taglineSize: 15,
      title: 'Local AI Anonymizer', tagline: 'Private data stays private when you use AI tools.',
    }));
    await writeFile(join(OUT, 'promo-marquee-1400x560.png'), await composeTile(composer, {
      width: 1400, height: 560, iconUrl, iconSize: 190, titleSize: 68, taglineSize: 28,
      title: 'Local AI Anonymizer', tagline: 'Hide names, emails and card numbers before you paste into AI tools.<br>Runs entirely on your device.',
    }));
    await writeFile(join(OUT, 'store-icon-128.png'), await composeStoreIcon(composer, iconUrl));
    console.log('wrote promo tiles and store icon');
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`store assets failed: ${err.message}`);
  process.exitCode = 1;
});
