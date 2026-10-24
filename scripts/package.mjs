// Builds dist/local-ai-anonymizer-<version>.zip: everything the browser needs
// (manifest, icons, source, bundled runtime and model) and nothing else.
// Usage: node scripts/package.mjs

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_MODEL } from '../src/core/ner.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const INCLUDE = ['manifest.json', 'icons', 'src', 'vendor'];
const REQUIRED = [
  'vendor/transformers/transformers.min.js',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  ...BUILTIN_MODEL.files.map((file) => `vendor/models/${BUILTIN_MODEL.id}/${file}`),
];

const exists = (path) => stat(join(ROOT, path)).then(() => true, () => false);

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
  const target = join(DIST, `local-ai-anonymizer-${version}.zip`);
  await mkdir(DIST, { recursive: true });
  await rm(target, { force: true });
  // -X drops macOS extra attributes; .DS_Store files are excluded.
  execFileSync('zip', ['-r', '-X', '-q', target, ...INCLUDE, '-x', '*.DS_Store'], { cwd: ROOT, stdio: 'inherit' });
  const { size } = await stat(target);
  console.log(`built ${target.replace(`${ROOT}/`, '')} (${(size / 1e6).toFixed(1)} MB)`);
} catch (err) {
  console.error(`package step failed: ${err.message}`);
  process.exitCode = 1;
}
