// Turns token-classification output (word pieces with B-/I- tags, no
// character offsets) back into whole entities with offsets in the text.
// Pure: the model itself runs in the offscreen document.

import { chunkText } from './llm.js';
import { truecase } from './truecase.js';
import { completePersons, completeOrganizations, fieldNames, miscAsPerson, knownWordCheck } from './name-parts.js';

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
// Multi-word person names get a lower bar: a command word at the start of a
// prompt ("Call Priya Raman...") drops the model's confidence to about 0.5.
// Single words keep the normal bar ("Stack trace" was tagged at 0.5).
// Measured with npm run eval.
export const PERSON_MIN_SCORE = 0.45;
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
  // Regional titles: "Eng. Samir Haddad" (found live), "Sheikh", "Kak" (Kurdish Mr.).
  'eng', 'engr', 'eng.', 'sheikh', 'shaikh', 'sh', 'hajj', 'haj', 'hajji', 'ustaz', 'ustadh', 'kak', 'mam', 'h.e', 'he.',
  // Command verbs that open prompts (same list as orgs.js LEADING_WORDS).
  'explain', 'use', 'compare', 'write', 'summarize', 'summarise', 'review', 'draft', 'create', 'build',
  'analyze', 'analyse', 'describe', 'translate', 'check', 'find', 'show', 'list', 'give', 'make',
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
  // Tagged as places or companies, typed or truecased ("Kubernetes" 0.91 LOC).
  'Docker', 'Kubernetes', 'Postgres', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Grafana', 'Figma',
  'Linux', 'Android',
  'Docker Compose', 'Compose', 'Google Drive', 'Google Docs', 'Google Sheets', 'Google Meet', 'Microsoft Teams', 'VS Code',
  'Visual Studio', 'GitHub Actions', 'Power BI', 'Canva', 'Trello', 'Asana', 'WhatsApp', 'Telegram', 'Moodle', 'Blackboard',
  'Coursera', 'LinkedIn',
  'Passport',
  // ID keywords: found live on ChatGPT, "CIN" in a CSV row was hidden as a
  // person and, saved in the vault, hidden in every later paste.
  'CIN', 'CNIE', 'Iqama', 'Civil ID', 'National ID', 'Emirates ID', 'Emirates', 'NID',
  // Greetings the model reads as names ("Ramadan Kareem" came back PER 0.99).
  'Ramadan', 'Ramadan Kareem', 'Ramadan Mubarak', 'Eid', 'Eid Mubarak', 'Eid Saeed', 'Inshallah', 'Insha Allah',
  'Mashallah', 'Alhamdulillah', 'Habibi', 'Yalla', 'Salam', 'Assalamu Alaikum', 'Marhaba', 'Shukran',
  // Job-title words on a signature line ("Senior" came back I-PER after a name).
  'Senior', 'Junior', 'Lead', 'Head', 'Chief', 'Principal', 'Analyst', 'Manager', 'Director', 'Consultant',
]);

// Judged without case: the model reads a truecased copy, where "kyc" or
// "KYC" in a shouted cell arrives as "Kyc".
const NEVER_LOWER = new Set([...NEVER_ENTITIES].map((e) => e.toLowerCase()));
export const isNeverEntity = (text) => NEVER_LOWER.has(text.toLowerCase());

const JOINER = /^[-'’]$/;
// Gaps allowed inside one entity. No line breaks: a signature block like
// "John Smith / Acme Corp / London" is three entities, not one.
const NEAR_GAP = /^[ \t\-'’.]{0,3}$/;

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

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// A command word at the start of a prompt ("Call Priya Raman...") can leave
// the model unsure of a name and mislabel the surname (I-ORG). Keep it with
// the person only when the model is unsure of both words; a confident name
// ("Maria Gonzalez") must not swallow a following organization.
function unsureSurname(current, token, gap) {
  return Boolean(current) && current.kind === 'PER' && token.prefix === 'I' && token.kind !== 'PER'
    && gap === ' ' && token.score < NER_MIN_SCORE && mean(current.scores) < NER_MIN_SCORE;
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
    const sameKind = current && current.kind === token.kind;
    const continues = (sameKind && (gap === '' || (token.prefix === 'I' && NEAR_GAP.test(gap))))
      || unsureSurname(current, token, gap);
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

// "Ask", "Call", "Dear" on their own are never a name, however the model scores them.
const isNoiseWord = (value) => LEADING_NOISE.has(value.toLowerCase().replace(/[.,:]$/, ''));

function trimLeadingNoise(text, start, end) {
  let from = start;
  for (;;) {
    const match = /^(\S+)\s+/.exec(text.slice(from, end));
    if (!match || !LEADING_NOISE.has(match[1].toLowerCase().replace(/[.,:]$/, ''))) return from;
    from += match[0].length;
  }
}

// "Aisha Bello aisha@unilag.example": the model runs the name into the
// email's local part. That word belongs to the email (a pattern span).
function trimEmailLocal(text, start, end) {
  if (text[end] !== '@') return end;
  const cut = text.slice(start, end).search(/\s+\S*$/);
  return cut === -1 ? end : start + cut;
}

const isMultiWord = (value) => /\s/.test(value.trim());

// Multi-word person names get the lower bar; judged after greeting and
// command words are trimmed, so "Hi Team" is not a two-word name. So does a
// single proper noun the vocabulary doesn't know in lowercase ("Tareq" read
// as LOC 0.61, "Karim" 0.50): "Stack" (0.5 in "Stack trace") is still held
// to the normal bar because "stack" is an everyday word.
function threshold(kind, value, minScore, isProperNoun) {
  const lower = Math.min(minScore, PERSON_MIN_SCORE);
  if (kind === 'PER' && isMultiWord(value)) return lower;
  return isProperNoun && !isMultiWord(value) && isProperNoun(value.trim()) ? lower : minScore;
}

// `types` (optional): entity types the caller wants; used to decide whether a
// place may be folded into a following organization name.
// `isKnownWord` (optional, the model's vocabulary): turns on name completion
// (name-parts.js): MISC groups of unknown words become people, and a person
// takes in the surname, first name or particle the model left out.
export function alignTokens(text, tokens, { offset = 0, minScore = NER_MIN_SCORE, types, isKnownWord } = {}) {
  if (!text) return [];
  const mergePlaces = !types || types.includes('ORGANIZATION');
  const located = locate(text, tokens);
  const merged = mergeJoined(text, group(text, located), { minScore, mergePlaces });
  return completeNames(text, merged, located, isKnownWord)
    .filter((g) => LABEL_TO_TYPE[g.kind])
    .map((g) => {
      // The model can start a name on the dot of "Prof." (". Abu Bakr").
      const lead = /^[\s.,;:'"()-]*/.exec(text.slice(g.start, g.end))[0].length;
      const start = trimLeadingNoise(text, g.start + lead, g.end);
      const end = trimEmailLocal(text, start, g.end);
      return { kind: g.kind, text: text.slice(start, end), start, end, score: mean(g.scores) };
    })
    .filter((e) => e.score >= threshold(e.kind, e.text, minScore, properNounCheck(isKnownWord)))
    .map((e) => ({ text: e.text, type: LABEL_TO_TYPE[e.kind], start: e.start + offset, end: e.end + offset, score: e.score }))
    .filter((e) => e.text.length >= 2 && !isNeverEntity(e.text) && !isNoiseWord(e.text))
    // Two groups can trim to the same name ("Eng." + "Samir Haddad").
    .filter((e, i, all) => all.findIndex((o) => o.start === e.start && o.end === e.end) === i);
}

// Capitalized and unknown to the vocabulary in lowercase: a name or place.
const properNounCheck = (isKnownWord) => (isKnownWord
  ? (word) => /^\p{Lu}\p{Ll}/u.test(word) && /^[\p{L}'’-]+$/u.test(word) && !isKnownWord(word.toLowerCase())
  : null);

function completeNames(text, groups, located, isKnownWord) {
  if (!isKnownWord) return groups;
  const isKnown = knownWordCheck(isKnownWord);
  const labelled = (start, end) => located.some((t) => t.kind && t.start < end && start < t.end);
  const isNoise = (word) => isNoiseWord(word) || isNeverEntity(word);
  const isProperNoun = (word) => !isKnownWord(word.toLowerCase());
  const strong = (g) => mean(g.scores) >= NER_MIN_SCORE && g.kind !== 'MISC';
  const people = completePersons(text, groups.map(miscAsPerson(text, isKnown, isNoise)), { isProperNoun, labelled, isNoise, strong });
  const fielded = fieldNames(text, people, { isProperNoun, isNoise, strong });
  return completeOrganizations(text, fielded, { isProperNoun, isNoise });
}

// CSV/TSV: rows read together confuse the model (a header line and no spaces
// after commas: "Wei Zhang" came back LOC 0.28). A row splits on tabs or on
// commas with no space after them (prose writes ", "); two or more
// neighbouring rows with the same number of fields make a table. Each row is
// read on its own; the lines around them ("Count the rows in this CSV:",
// found live on ChatGPT) stay together.
// Markdown rows ("| Contact | Tareq Odeh |") count too.
const ROW_SEP = /\t|,(?! )|\|/g;
const fieldCount = (line) => (line.match(ROW_SEP) ?? []).length;

function splitLines(chunk) {
  let offset = chunk.offset;
  return chunk.text.split('\n').map((text) => {
    const line = { text, offset };
    offset += text.length + 1;
    return line;
  });
}

function rowFlags(lines) {
  const filled = lines.map((l, i) => i).filter((i) => lines[i].text.trim());
  const counts = lines.map((l) => fieldCount(l.text));
  const flags = lines.map(() => false);
  filled.forEach((i, k) => {
    const near = [filled[k - 1], filled[k + 1]].filter((j) => j !== undefined);
    flags[i] = counts[i] > 0 && near.some((j) => counts[j] === counts[i]);
  });
  return flags;
}

function tableRows(chunk) {
  const lines = splitLines(chunk);
  const flags = rowFlags(lines);
  if (!flags.some(Boolean)) return [chunk];
  const parts = [];
  let run = null;
  lines.forEach((line, i) => {
    if (!flags[i]) {
      run = run ? { text: `${run.text}\n${line.text}`, offset: run.offset } : line;
      return;
    }
    if (run) parts.push(run);
    run = null;
    parts.push(line);
  });
  if (run) parts.push(run);
  return parts.filter((part) => part.text.trim());
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

// Table pipes confuse the model: "| Contact | Maya Khoury |" came back ORG
// 0.60 for "Maya", with the pipes as spaces PER 0.96. Curly quotes hide
// names too ("“Hawler”"). Same length either way.
const withoutPipes = (text) => text.replace(/\|/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

// Runs `runModel(chunkText)` (which returns token-classification output with
// ignore_labels: []) over the text in sentence-sized chunks. Pass
// `countTokens` (the model's tokenizer) so no chunk is silently truncated.
// Pass `isKnownWord` (the model's vocabulary) to let it see lowercase names:
// it reads a truecased copy, and entities are cut from the original text.
export async function detectWithModel(text, runModel, types, { countTokens, maxTokens = NER_MAX_TOKENS, isKnownWord } = {}) {
  if (!text.trim()) return [];
  // Truecased once for the whole text (same length), so an ALL CAPS table
  // is lowered as a whole even though its rows are read one at a time.
  const seen = isKnownWord ? truecase(text, isKnownWord) : text;
  const found = [];
  for (const sized of chunkText(seen, NER_CHUNK_CHARS).flatMap(tableRows)) {
    for (const chunk of await fitToModel(sized, countTokens, maxTokens)) {
      const modelText = withoutPipes(chunk.text);
      const tokens = await runModel(modelText);
      found.push(...alignTokens(modelText, tokens, { types, isKnownWord, offset: chunk.offset })
        .filter((e) => types.includes(e.type))
        .map((e) => ({ ...e, text: text.slice(e.start, e.end) })));
    }
  }
  const unique = new Map(found.map((e) => [`${e.type}:${e.text}`, { text: e.text, type: e.type }]));
  return [...unique.values()];
}
