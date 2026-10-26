// Builds dist/local-ai-anonymizer-<version>.zip: everything the browser needs
// (manifest, icons, source, bundled runtime and model) and nothing else.
// Pure Node (fflate), so it works the same on Windows, macOS and Linux, and
// fixed timestamps make the zip byte-identical for the same sources.
// Usage: node scripts/package.mjs

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { BUILTIN_MODEL } from '../src/core/ner.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const INCLUDE = ['manifest.json', 'icons', 'src', 'vendor'];
const SKIP = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const STORED = /\.(png|jpe?g|gif|webp|zip)$/i; // already compressed
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');
const REQUIRED = [
  'vendor/transformers/transformers.min.js',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  'vendor/fflate/fflate.js',
  ...BUILTIN_MODEL.files.map((file) => `vendor/models/${BUILTIN_MODEL.id}/${file}`),
];

const exists = (path) => stat(join(ROOT, path)).then(() => true, () => false);

// Zip entry names always use "/", whatever the platform's separator.
const entryName = (absolute) => relative(ROOT, absolute).split(sep).join('/');

async function collect(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return [path];
  const names = (await readdir(path)).filter((n) => !SKIP.has(n)).sort();
  const nested = await Promise.all(names.map((n) => collect(join(path, n))));
  return nested.flat();
}

async function checkVersions() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    throw new Error(`manifest.json version ${manifest.version} does not match package.json ${pkg.version}`);
  }
  return manifest.version;
}

try {
  const missing = [];
  for (const path of REQUIRED) if (!(await exists(path))) missing.push(path);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Run "npm run vendor" first.`);

  const version = await checkVersions();
  const files = (await Promise.all(INCLUDE.map((p) => collect(join(ROOT, p))))).flat();
  const entries = {};
  for (const file of files) {
    entries[entryName(file)] = [new Uint8Array(await readFile(file)), { level: STORED.test(file) ? 0 : 6, mtime: FIXED_TIME }];
  }
  const target = join(DIST, `local-ai-anonymizer-${version}.zip`);
  await mkdir(DIST, { recursive: true });
  await rm(target, { force: true });
  const zipped = zipSync(entries);
  await writeFile(target, zipped);
  console.log(`built ${relative(ROOT, target)} (${files.length} files, ${(zipped.length / 1e6).toFixed(1)} MB)`);
} catch (err) {
  console.error(`package step failed: ${err.message}`);
  process.exitCode = 1;
}
