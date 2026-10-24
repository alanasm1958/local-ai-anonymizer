// Turns token-classification output (word pieces with B-/I- tags, no
// character offsets) back into whole entities with offsets in the text.
// Pure: the model itself runs in the offscreen document.

import { chunkText } from './llm.js';

export const BUILTIN_MODEL = Object.freeze({
  id: 'onnx-community/distilbert-NER-ONNX',
  revision: '3a19fe9404a4469d91aa3d551558a97f68872f67', // pinned: vendor.mjs downloads exactly this
  dtype: 'q8',
  file: 'onnx/model_quantized.onnx',
  // Everything the runtime loads; vendor.mjs downloads these, package.mjs checks them.
  files: Object.freeze(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']),
  label: 'DistilBERT-NER (English)',
  sizeMb: 66,
});

export const NER_MIN_SCORE = 0.6;
export const NER_CHUNK_CHARS = 1200; // about 300 tokens for prose
// The model reads at most 512 tokens and silently drops the rest. Code, URLs
// and hex tokenize at up to one token per character, so chunks are re-split
// by real token count, with room for the [CLS]/[SEP] markers.
export const NER_MAX_TOKENS = 450;
const MIN_SPLIT_CHARS = 40;

const LABEL_TO_TYPE = Object.freeze({ PER: 'PERSON', ORG: 'ORGANIZATION', LOC: 'LOCATION' });

// Words the model often glues onto the front of a name ("Email Jean-Luc",
// "Dr Ana Lima"). Stripping them means every other mention of the bare name
// is still matched.
const LEADING_NOISE = new Set([
  'dear', 'hi', 'hello', 'hey', 'email', 'e-mail', 'call', 'contact', 'ask', 'tell', 'ping',
  'message', 'text', 'meet', 'thanks', 'thank', 'cc', 'attn', 'from', 'to', 'with',
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'madam',
]);

// Exact strings the model tends to tag but that identify nobody: form field
// labels, role and domain acronyms, everyday software. Seen in the eval set
// ("DOB" as a place, "KYC"/"ECG" as organizations, "Excel" as a company).
export const NEVER_ENTITIES = new Set([
  'DOB', 'SSN', 'MRN', 'IBAN', 'PIN', 'ID', 'NHS', 'VAT', 'EIN', 'TIN',
  'KYC', 'AML', 'ECG', 'EKG', 'MRI', 'ICU', 'ER', 'GP',
  'CEO', 'CFO', 'CTO', 'COO', 'CIO', 'VP', 'HR', 'IT', 'QA', 'PM', 'PR', 'R&D',
  'AI', 'ML', 'API', 'URL', 'PDF', 'CSV', 'SQL', 'FAQ', 'ETA', 'ASAP', 'FYI', 'TBD', 'KPI', 'OKR', 'ROI',
  'Q1', 'Q2', 'Q3', 'Q4',
  'Python', 'JavaScript', 'TypeScript', 'Excel', 'Word', 'PowerPoint', 'Outlook', 'Teams', 'Slack',
  'Zoom', 'Gmail', 'Jira', 'Confluence', 'GitHub', 'Notion', 'ChatGPT', 'Claude', 'Gemini', 'Copilot',
]);

const JOINER = /^[-'’]$/;
const NEAR_GAP = /^[\s\-'’.]{0,3}$/;

const parseLabel = (label) => {
  const match = /^([BI])-(.+)$/.exec(label ?? '');
  return match ? { prefix: match[1], kind: match[2] } : { prefix: null, kind: null };
};

// Finds each piece in order. Pieces that can't be found ([UNK], normalized
// characters) are skipped and the cursor stays put, so later pieces still align.
function locate(text, tokens) {
  const located = [];
  let cursor = 0;
  for (const token of tokens) {
    const isSub = token.word.startsWith('##');
    const piece = isSub ? token.word.slice(2) : token.word;
    if (!piece || /^\[[A-Z]+\]$/.test(piece)) continue;
    const start = text.indexOf(piece, cursor);
    if (start === -1) continue;
    located.push({ start, end: start + piece.length, score: token.score, isSub, ...parseLabel(token.entity) });
    cursor = start + piece.length;
  }
  return located;
}

const newGroup = (token) => ({ kind: token.kind, start: token.start, end: token.end, scores: [token.score] });

const extend = (group, token) => ({
  ...group, end: token.end, scores: [...group.scores, token.score],
});

function group(text, located) {
  const groups = [];
  let current = null;
  const close = () => {
    if (current) groups.push(current);
    current = null;
  };
  for (const token of located) {
    if (token.isSub) {
      // Word pieces belong to whatever word they are glued to.
      if (current && token.start === current.end) current = extend(current, token);
      continue;
    }
    if (!token.kind) {
      close();
      continue;
    }
    const gap = current ? text.slice(current.end, token.start) : '';
    const continues = current && current.kind === token.kind
      && ((token.prefix === 'I' && NEAR_GAP.test(gap)) || gap === '');
    if (continues) {
      current = extend(current, token);
    } else {
      close();
      current = newGroup(token);
    }
  }
  close();
  return groups;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Two adjacent groups that are really one entity:
// - "O'Brien" + "-" (tagged O) + "Gonzalez": same type across a joiner.
// - "Northwind" (LOC) + "Traders" (ORG), "Leeds" + "City Council": a place
//   name directly in front of an organization is part of its name. Only when
//   both halves are confident on their own (so a weak ORG can't ride on a
//   strong LOC) and organizations are wanted (else the place would vanish).
function belongsTogether(text, prev, g, { minScore, mergePlaces }) {
  const gap = text.slice(prev.end, g.start);
  if (prev.kind === g.kind) return JOINER.test(gap);
  return mergePlaces && prev.kind === 'LOC' && g.kind === 'ORG' && gap === ' '
    && mean(prev.scores) >= minScore && mean(g.scores) >= minScore;
}

function mergeJoined(text, groups, options) {
  return groups.reduce((acc, g) => {
    const prev = acc.at(-1);
    if (prev && belongsTogether(text, prev, g, options)) {
      return [...acc.slice(0, -1), { ...prev, kind: g.kind, end: g.end, scores: [...prev.scores, ...g.scores] }];
    }
    return [...acc, g];
  }, []);
}

function trimLeadingNoise(text, start, end) {
  let from = start;
  for (;;) {
    const match = /^(\S+)\s+/.exec(text.slice(from, end));
    if (!match || !LEADING_NOISE.has(match[1].toLowerCase().replace(/[.,:]$/, ''))) return from;
    from += match[0].length;
  }
}

// `types` (optional): entity types the caller wants; used to decide whether a
// place may be folded into a following organization name.
export function alignTokens(text, tokens, { offset = 0, minScore = NER_MIN_SCORE, types } = {}) {
  if (!text) return [];
  const mergePlaces = !types || types.includes('ORGANIZATION');
  return mergeJoined(text, group(text, locate(text, tokens)), { minScore, mergePlaces })
    .filter((g) => LABEL_TO_TYPE[g.kind] && mean(g.scores) >= minScore)
    .map((g) => {
      const start = trimLeadingNoise(text, g.start, g.end);
      return { text: text.slice(start, g.end), type: LABEL_TO_TYPE[g.kind], start: start + offset, end: g.end + offset, score: mean(g.scores) };
    })
    .filter((e) => e.text.length >= 2 && !NEVER_ENTITIES.has(e.text));
}

async function fitToModel(chunk, countTokens, maxTokens) {
  if (!countTokens || chunk.text.length < MIN_SPLIT_CHARS) return [chunk];
  if ((await countTokens(chunk.text)) <= maxTokens) return [chunk];
  const parts = chunkText(chunk.text, Math.ceil(chunk.text.length / 2))
    .map((part) => ({ text: part.text, offset: chunk.offset + part.offset }));
  const fitted = [];
  for (const part of parts) fitted.push(...await fitToModel(part, countTokens, maxTokens));
  return fitted;
}

// Runs `runModel(chunkText)` (which returns token-classification output with
// ignore_labels: []) over the text in sentence-sized chunks. Pass
// `countTokens` (the model's tokenizer) so no chunk is silently truncated.
export async function detectWithModel(text, runModel, types, { countTokens, maxTokens = NER_MAX_TOKENS } = {}) {
  if (!text.trim()) return [];
  const found = [];
  for (const sized of chunkText(text, NER_CHUNK_CHARS)) {
    for (const chunk of await fitToModel(sized, countTokens, maxTokens)) {
      const tokens = await runModel(chunk.text);
      found.push(...alignTokens(chunk.text, tokens, { types }).filter((e) => types.includes(e.type)));
    }
  }
  const unique = new Map(found.map((e) => [`${e.type}:${e.text}`, { text: e.text, type: e.type }]));
  return [...unique.values()];
}
