// Builds the package handed to IT: the extension zip, the staff guide and the
// IT install guide as PDFs, in dist/Amideast IT package <version>/ and as one zip.
// Run `npm run package` first. Usage: node scripts/it-bundle.mjs

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');
const PDF_OPTIONS = { format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } };

async function readVersion() {
  const { version } = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  if (!version) throw new Error('manifest.json has no version');
  return version;
}

async function renderPdf(browser, htmlPath, outPath, version) {
  // Fill {{VERSION}} in a temporary copy next to the original so relative CSS paths still work.
  const source = await readFile(htmlPath, 'utf8');
  const tempPath = htmlPath.replace(/\.html$/, '.render.html');
  await writeFile(tempPath, source.replaceAll('{{VERSION}}', version));
  try {
    const page = await browser.newPage({ colorScheme: 'light' });
    await page.goto(pathToFileURL(tempPath).href, { waitUntil: 'load' });
    await page.pdf({ path: outPath, ...PDF_OPTIONS });
    await page.close();
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function main() {
  const version = await readVersion();
  const extensionZip = `local-ai-anonymizer-${version}.zip`;
  const folderName = `Amideast IT package ${version}`;
  const outDir = join(DIST, folderName);

  await readFile(join(DIST, extensionZip)).catch(() => {
    throw new Error(`dist/${extensionZip} not found. Run "npm run package" first.`);
  });

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyFile(join(DIST, extensionZip), join(outDir, extensionZip));

  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    await renderPdf(browser, join(ROOT, 'src/help/help.html'), join(outDir, 'How to use (staff guide).pdf'), version);
    await renderPdf(browser, join(ROOT, 'it/it-guide.html'), join(outDir, 'IT install guide.pdf'), version);
  } finally {
    await browser.close();
  }

  const names = [extensionZip, 'How to use (staff guide).pdf', 'IT install guide.pdf'];
  const entries = {};
  for (const name of names) {
    entries[`${folderName}/${name}`] = [new Uint8Array(await readFile(join(outDir, name))), { mtime: FIXED_TIME, level: 0 }];
  }
  const bundlePath = join(DIST, `Amideast-IT-package-${version}.zip`);
  await writeFile(bundlePath, zipSync(entries));
  process.stdout.write(`Wrote dist/${folderName}/ and dist/Amideast-IT-package-${version}.zip\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
