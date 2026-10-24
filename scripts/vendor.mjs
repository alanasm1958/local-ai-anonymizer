// Copies the in-browser model runtime into vendor/ and downloads the built-in
// NER model so the extension works fully offline. MV3 forbids remotely hosted
// code, so Transformers.js and the ONNX Runtime wasm must ship with the
// extension. Usage: node scripts/vendor.mjs [--no-model]

import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_MODEL } from '../src/core/ner.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const NODE_MODULES = join(ROOT, 'node_modules');

const COPIES = [
  ['@huggingface/transformers/dist/transformers.min.js', 'transformers/transformers.min.js'],
  ['@huggingface/transformers/LICENSE', 'transformers/LICENSE'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'ort/ort-wasm-simd-threaded.asyncify.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', 'ort/ort-wasm-simd-threaded.asyncify.wasm'],
  // Zip reader/writer for .docx/.xlsx/.pptx files (MIT).
  ['fflate/esm/browser.js', 'fflate/fflate.js'],
  ['fflate/LICENSE', 'fflate/LICENSE'],
];


const exists = (path) => stat(path).then(() => true, () => false);

async function copyRuntime() {
  for (const [from, to] of COPIES) {
    const target = join(VENDOR, to);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(NODE_MODULES, from), target);
    console.log(`copied ${to}`);
  }
  // The npm package ships without a LICENSE file; its README states MIT.
  await writeFile(join(VENDOR, 'ort/NOTICE.txt'), 'onnxruntime-web: MIT License, Copyright (c) Microsoft Corporation. https://github.com/microsoft/onnxruntime\n');
}

async function download(url, target) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await res.arrayBuffer()));
}

async function downloadModel() {
  for (const file of BUILTIN_MODEL.files) {
    const target = join(VENDOR, 'models', BUILTIN_MODEL.id, file);
    if (await exists(target)) {
      console.log(`have ${file}`);
      continue;
    }
    const url = `https://huggingface.co/${BUILTIN_MODEL.id}/resolve/${BUILTIN_MODEL.revision}/${file}`;
    console.log(`downloading ${file}...`);
    await download(url, target);
  }
}

try {
  await copyRuntime();
  if (!process.argv.includes('--no-model')) await downloadModel();
  console.log('vendor/ ready');
} catch (err) {
  console.error(`vendor step failed: ${err.message}`);
  if (err.code === 'ENOENT') console.error('Run "npm install" first.');
  process.exitCode = 1;
}
