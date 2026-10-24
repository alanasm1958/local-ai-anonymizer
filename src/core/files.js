// Anonymize and restore whole files: plain text and code, JSON, and Office
// documents (docx, xlsx, pptx). Pure apart from the injected callbacks, so it
// runs in the service worker and in Node tests. Anything it cannot check
// (PDF, images, archives, old binary Office formats) is reported as
// unsupported with a reason, never passed through as if it were clean.

import {
  extractSegments, extractAttributeSegments, rewriteSegments, spliceSegments, clearMetadata, uncheckedNotes,
  hasNumericCells, rulesFor, blankThumbnail,
} from './ooxml.js';
import { PLACEHOLDER_RE } from './vault.js';

export { rewriteSegments, extractOoxmlText } from './ooxml.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// A small zip can unpack to gigabytes ("zip bomb"); declared sizes are
// checked before anything is decompressed.
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'properties', 'html', 'htm', 'css', 'scss', 'sql', 'tex', 'srt', 'vtt', 'ics', 'vcf',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'go', 'rs',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'm', 'r', 'pl', 'lua', 'dart', 'sh', 'bash', 'zsh', 'ps1',
  'bat', 'vue', 'svelte', 'graphql', 'gql', 'proto', 'tf', 'hcl', 'gradle', 'jsonl', 'ndjson',
]);

const UNSUPPORTED_REASONS = Object.freeze([
  [/^pdf$/, 'PDF files can\'t be checked'],
  [/^(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg|avif)$/, 'images can\'t be checked'],
  [/^(doc|xls|ppt|rtf|odt|ods|odp|pages|numbers|key)$/, 'this document format can\'t be checked (save it as .docx, .xlsx or .pptx)'],
  [/^(zip|rar|7z|gz|tgz|tar|bz2)$/, 'archives can\'t be checked'],
  [/^(mp3|wav|m4a|mp4|mov|avi|webm|ogg)$/, 'audio and video can\'t be checked'],
]);

const extensionOf = (name) => {
  const base = name.split(/[\\/]/).pop().toLowerCase();
  if (/^\.[a-z0-9]+$/.test(base)) return base.slice(1); // ".env"
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
};

export function classifyFile({ name, type, size }) {
  if (size > MAX_FILE_BYTES) return { kind: 'unsupported', reason: `the file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` };
  const ext = extensionOf(name);
  if (ext === 'json') return { kind: 'json' };
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return { kind: ext };
  if (TEXT_EXTENSIONS.has(ext)) return { kind: 'text' };
  const known = UNSUPPORTED_REASONS.find(([re]) => re.test(ext));
  if (known) return { kind: 'unsupported', reason: known[1] };
  if (/^text\//.test(type ?? '') || type === 'application/json') return { kind: type === 'application/json' ? 'json' : 'text' };
  if (/^image\//.test(type ?? '')) return { kind: 'unsupported', reason: 'images can\'t be checked' };
  return { kind: 'unsupported', reason: 'this file type can\'t be checked' };
}

// Format problems (not UTF-8, not a valid zip) mean "can't check", which is
// different from a failure of the detection model.
class FormatError extends Error {}

const BOM = [0xef, 0xbb, 0xbf];
const hasBom = (bytes) => BOM.every((b, i) => bytes[i] === b);

function decodeText(bytes) {
  const bom = hasBom(bytes);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
    if (text.length > MAX_TEXT_CHARS) throw new FormatError('it has too much text to check');
    return { text, bom };
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError('it isn\'t UTF-8 text');
  }
}

function encodeText(text, bom) {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(BOM.length + body.length);
  out.set(BOM);
  out.set(body, BOM.length);
  return out;
}

// ---------- handlers: bytes in, { bytes, changed } out ----------
// `transform(text)` returns { text, spans: [{ start, end, text }] }.

async function handleText(bytes, { transform }) {
  const { text, bom } = decodeText(bytes);
  const result = await transform(text);
  return { bytes: encodeText(result.text, bom), changed: result.spans.length > 0 };
}

// JSON strings (keys and values) are edited in place in the original text,
// so numbers, spacing and escapes elsewhere stay byte for byte the same.
// They are checked in one pass, joined by a separator no detector matches
// across, and split back afterwards.
const SEPARATOR = '\n␞\n';
const STRING_TOKEN = /"(?:[^"\\]|\\.)*"/g;

async function handleJson(bytes, ctx) {
  const { text, bom } = decodeText(bytes);
  try {
    JSON.parse(text);
  } catch {
    return handleText(bytes, ctx);
  }
  const tokens = [...text.matchAll(STRING_TOKEN)];
  const values = tokens.map((m) => JSON.parse(m[0]));
  if (ctx.mode === 'clean' && /\d/.test(text.replace(STRING_TOKEN, ''))) {
    ctx.notes.push('Numbers in the JSON (not text) were not checked.');
  }
  const result = await ctx.transform(values.join(SEPARATOR));
  if (!result.spans.length) return { bytes, changed: false };
  const updated = result.text.split(SEPARATOR);
  if (updated.length !== values.length) throw new Error('JSON strings could not be matched back');
  let out = '';
  let cursor = 0;
  tokens.forEach((m, i) => {
    out += text.slice(cursor, m.index) + (updated[i] === values[i] ? m[0] : JSON.stringify(updated[i]));
    cursor = m.index + m[0].length;
  });
  return { bytes: encodeText(out + text.slice(cursor), bom), changed: true };
}

function unzipChecked(bytes, zip, limit) {
  let unpacked = 0;
  try {
    return zip.unzipSync(bytes, {
      filter: (info) => {
        unpacked += info.originalSize;
        if (unpacked > limit) throw new FormatError('it is too large when unpacked');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError('it isn\'t a valid Office file');
  }
}

const decodeBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Applies every rule for one part; returns the new XML (or the same string).
async function cleanPart(xml, rules, ctx) {
  if (xml.includes('<![CDATA[')) throw new FormatError('it contains text stored in a way that can\'t be checked');
  let current = xml;
  for (const rule of rules) {
    const extracted = rule.tag ? extractSegments(current, rule.tag, rule.breaks) : extractAttributeSegments(current, rule.pattern);
    ctx.textChars += extracted.text.length;
    if (ctx.textChars > MAX_TEXT_CHARS) throw new FormatError('it has too much text to check');
    if (!extracted.text.trim()) continue;
    const result = await ctx.transform(extracted.text);
    if (!result.spans.length) continue;
    const contents = rewriteSegments(extracted.text, extracted.segments, result.spans);
    current = spliceSegments(current, extracted, contents, rule.tag);
  }
  return current;
}

async function handleOoxml(bytes, ctx, kind) {
  const { zip } = ctx;
  const entries = unzipChecked(bytes, zip, ctx.maxUnpackedBytes ?? MAX_UNPACKED_BYTES);
  const paths = Object.keys(entries);
  let changed = false;
  ctx.textChars = 0;
  for (const path of paths) {
    const blank = ctx.mode === 'clean' ? blankThumbnail(path) : null;
    if (blank) {
      entries[path] = decodeBase64(blank);
      ctx.notes.push('The preview thumbnail was replaced with a blank image.');
      changed = true;
      continue;
    }
    const rules = rulesFor(kind, path);
    if (!rules.length) continue;
    const xml = zip.strFromU8(entries[path]);
    const cleaned = await cleanPart(xml, rules, ctx);
    if (kind === 'xlsx' && /worksheets/.test(path) && hasNumericCells(cleaned)) ctx.numericCells = true;
    if (cleaned !== xml) {
      entries[path] = zip.strToU8(cleaned);
      changed = true;
    }
  }
  if (ctx.mode === 'clean') {
    changed = stripMetadata(entries, zip, ctx) || changed;
    ctx.notes.push(...uncheckedNotes(paths, kind));
    if (ctx.numericCells) ctx.notes.push('Cells stored as numbers (not text) were not checked, so card or phone numbers typed as plain numbers may remain.');
  }
  return { bytes: changed ? zip.zipSync(entries) : bytes, changed };
}

function stripMetadata(entries, zip, ctx) {
  let changed = false;
  Object.keys(entries).forEach((path) => {
    if (!/\.(xml|rels)$/.test(path)) return;
    const xml = zip.strFromU8(entries[path]);
    const cleared = clearMetadata(path, xml);
    if (cleared !== xml) {
      entries[path] = zip.strToU8(cleared);
      changed = true;
    }
  });
  if (changed) ctx.notes.push('Author names and document properties were removed.');
  return changed;
}

const HANDLERS = Object.freeze({
  text: handleText,
  json: handleJson,
  docx: (bytes, ctx) => handleOoxml(bytes, ctx, 'docx'),
  xlsx: (bytes, ctx) => handleOoxml(bytes, ctx, 'xlsx'),
  pptx: (bytes, ctx) => handleOoxml(bytes, ctx, 'pptx'),
});

// ---------- file names ----------

function splitName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

const applySpans = (text, spans) => {
  let out = '';
  let cursor = 0;
  [...spans].sort((a, b) => a.start - b.start).forEach((s) => {
    out += text.slice(cursor, s.start) + s.text;
    cursor = s.end;
  });
  return out + text.slice(cursor);
};

// "Maria_Gonzalez_CV" and "Maria-Gonzalez-CV" are read as "Maria Gonzalez
// CV" (separators swapped one for one, so offsets line up), and the
// placeholder goes back into the original stem. Lowercase names
// ("openpyxl.xlsx", "report.txt") are tool and product words the model
// misreads as organizations; a person's name in a file name is almost
// always capitalized.
async function anonymizeName(name, transform) {
  const [stem, ext] = splitName(name);
  if (!/\p{Lu}/u.test(stem)) return name;
  const result = await transform(stem.replace(/[_-]/g, ' '));
  return result.spans.length ? applySpans(stem, result.spans) + ext : name;
}

// "[PERSON_1]-CV" gets "Maria-Gonzalez-CV" back: a name without spaces
// reuses its own separator (looked for outside the placeholders).
function restoreName(name, restoreSpans) {
  const [stem, ext] = splitName(name);
  const spans = restoreSpans(stem);
  if (!spans.length) return name;
  const separator = stem.includes(' ') ? null : (/[_-]/.exec(stem.replace(PLACEHOLDER_RE, ''))?.[0] ?? '_');
  const values = separator ? spans.map((s) => ({ ...s, text: s.text.replace(/ /g, separator) })) : spans;
  return applySpans(stem, values) + ext;
}

// ---------- public API ----------

async function processFile(file, mode, ctx) {
  const info = classifyFile({ name: file.name, type: file.type, size: file.bytes.length });
  if (info.kind === 'unsupported') {
    // Contents can't be checked, but the name still can.
    return {
      status: 'unsupported', reason: info.reason, name: await mode.name(file.name), type: file.type,
      bytes: file.bytes, replacements: ctx.replacements ?? [], notes: [],
    };
  }
  let result;
  try {
    result = await HANDLERS[info.kind](file.bytes, ctx);
  } catch (err) {
    if (err instanceof FormatError) {
      return { status: 'unsupported', reason: `${file.name} can't be checked: ${err.message}`, name: file.name, type: file.type, bytes: file.bytes, replacements: [], notes: [] };
    }
    throw err;
  }
  const name = await mode.name(file.name);
  const changed = result.changed || name !== file.name;
  return {
    status: changed ? mode.changedStatus : 'unchanged',
    name,
    type: file.type,
    bytes: result.changed ? result.bytes : file.bytes,
    replacements: ctx.replacements ?? [],
    notes: ctx.notes,
  };
}

// anonymizeText(text) -> { text, replacements: [{ placeholder, type, original, start, end }] }
export function anonymizeFile(file, { anonymizeText, zip, maxUnpackedBytes }) {
  const replacements = [];
  const transform = async (text) => {
    const result = await anonymizeText(text);
    for (const r of result.replacements) replacements.push(r);
    return { text: result.text, spans: result.replacements.map((r) => ({ start: r.start, end: r.end, text: r.placeholder })) };
  };
  const ctx = { transform, zip, notes: [], replacements, mode: 'clean', maxUnpackedBytes };
  return processFile(file, { name: (n) => anonymizeName(n, transform), changedStatus: 'cleaned' }, ctx);
}

// restoreSpans(text) -> [{ start, end, text: original }] for known placeholders.
export function restoreFile(file, { restoreSpans, zip, maxUnpackedBytes }) {
  const transform = async (text) => {
    const spans = restoreSpans(text);
    return { text: applySpans(text, spans), spans };
  };
  const ctx = { transform, zip, notes: [], mode: 'restore', maxUnpackedBytes };
  return processFile(file, { name: async (n) => restoreName(n, restoreSpans), changedStatus: 'restored' }, ctx);
}
