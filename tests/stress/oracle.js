// Strict leak oracle. Unlike tests/scenarios/check.js it ignores case, sees
// through invisible characters and other digit scripts, and counts partial
// leaks: one surname left behind, or 4 digits of a phone number.

export const PLACEHOLDER_RE = /\[[A-Z][A-Z_]*_\d+\]/g;

// Particles and generic words that reveal nothing on their own.
const GENERIC = new Set([
  'al', 'el', 'abu', 'ben', 'bin', 'abi', 'ibn', 'bint', 'abd', 'the',
  'co', 'ltd', 'llc', 'sarl', 'sal', 'group', 'holding', 'trading', 'logistics', 'consulting', 'engineering',
  'systems', 'textiles', 'pharma', 'company', 'capital', 'media', 'construction',
  'street', 'st', 'avenue', 'ave', 'road', 'rue', 'building', 'bldg', 'block', 'house', 'villa', 'floor', 'apartment',
  'box', 'near', 'behind', 'way', 'mall', 'family', 'church', 'saint', 'zuqaq', 'mahalla',
  'gmail', 'yahoo', 'hotmail', 'outlook', 'com', 'org', 'net', 'edu', 'gov', 'mail', 'jobs', 'dot', 'at',
]);

const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

const foldDigits = (s) => s
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// What a reader of the output can recover: NFKC (full-width digits), no
// invisible characters, all digit scripts as 0-9, placeholders cut out.
export const normalize = (s) => foldDigits(s.normalize('NFKC').replace(INVISIBLE, ''))
  .replace(/\u00a0/g, ' ')
  .replace(PLACEHOLDER_RE, ' | ');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

export const wordTokens = (value) => normalize(value).split(/[^\p{L}\p{N}]+/u)
  .filter((t) => [...t].length >= 3 && !GENERIC.has(t.toLowerCase()));

// Digit runs a reader would join up: separators inside a number are ignored.
const digitRuns = (text) => (normalize(text).match(/\d(?:[\d \t\-./()]*\d)?/g) ?? []).map((r) => r.replace(/\D/g, ''));

const windows = (s, size) => (s.length <= size ? [s] : Array.from({ length: s.length - size + 1 }, (_, i) => s.slice(i, i + size)));

function wordLeaks(value, output, background) {
  return wordTokens(value).filter((t) => hasWord(output, t) && !hasWord(background, t));
}

function digitLeaks(value, output, background) {
  const digits = normalize(value).replace(/\D/g, '');
  if (digits.length < 4) return [];
  const out = digitRuns(output).join('|');
  const bg = digitRuns(background).join('|');
  const found = windows(digits, 4).filter((w) => out.includes(w) && !bg.includes(w));
  return found.length ? [found.join(',')] : [];
}

function charLeaks(value, output, background) {
  const found = windows(value, 8).filter((w) => output.includes(w) && !background.includes(w));
  return found.length ? [found[0]] : [];
}

function exactLeaks(value, output, background) {
  const lower = (s) => normalize(s).toLowerCase();
  return lower(output).includes(lower(value)) && !lower(background).includes(lower(value)) ? [value] : [];
}

function emailLeaks(value, output, background) {
  const local = value.split(/@|\s+at\s+|\[at\]|\(at\)/i)[0];
  return [...new Set([...exactLeaks(value, output, background), ...wordLeaks(local, normalize(output), normalize(background))])];
}

const CHECKS = { words: wordLeaks, digits: digitLeaks, chars: charLeaks, exact: exactLeaks, email: emailLeaks };

// Returns { leaked: [fragments], overRedacted: [keep strings lost], verdict }.
// verdict: pass | fail | known_gap | gap_fixed | hidden (may_hide, was hidden) | kept (may_hide, left)
export function judgeCase(kase, output) {
  const plain = normalize(output);
  const bg = normalize(kase.background);
  const leaked = kase.secrets.flatMap((s) => {
    const check = CHECKS[s.kind];
    return check(s.value, plain, bg);
  });
  const overRedacted = kase.keep.filter((k) => !output.includes(k));
  const clean = leaked.length === 0 && overRedacted.length === 0;
  const verdict = {
    must_catch: clean ? 'pass' : 'fail',
    must_keep: overRedacted.length ? 'fail' : 'pass',
    known_gap: clean ? 'gap_fixed' : 'known_gap',
    may_hide: leaked.length ? 'kept' : 'hidden',
  }[kase.expected];
  return { leaked, overRedacted, verdict };
}
