// Extracts the release zip, the same way on every platform (CI uses it to
// run the end-to-end tests against the packaged extension).
// Usage: node scripts/extract-zip.mjs <target-dir> [zip]   (zip defaults to the one in dist/)

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function findZip() {
  const zips = (await readdir(join(ROOT, 'dist'))).filter((n) => n.endsWith('.zip'));
  if (zips.length !== 1) throw new Error(`Expected one zip in dist/, found ${zips.length}. Pass the zip path.`);
  return join(ROOT, 'dist', zips[0]);
}

try {
  const [targetArg, zipArg] = process.argv.slice(2);
  if (!targetArg) throw new Error('Usage: node scripts/extract-zip.mjs <target-dir> [zip]');
  const target = resolve(targetArg);
  const entries = unzipSync(new Uint8Array(await readFile(zipArg ?? await findZip())));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const out = resolve(target, ...name.split('/'));
    // Refuse entries that would escape the target folder ("../" in names).
    if (!out.startsWith(target + sep)) throw new Error(`Unsafe path in zip: ${name}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, data);
  }
  console.log(`extracted ${Object.keys(entries).length} files to ${target}`);
} catch (err) {
  console.error(`extract failed: ${err.message}`);
  process.exitCode = 1;
}
