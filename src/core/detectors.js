// Pattern detectors for structured sensitive data. Each detector has a regex
// (global, with the `d` flag so capture groups report offsets), an optional
// capture group to use as the span, and an optional validator.

const digitsOnly = (s) => s.replace(/\D/g, '');

export function luhnValid(input) {
  const digits = digitsOnly(input);
  if (digits.length < 13 || digits.length > 19) return false;
  const sum = [...digits].reverse().reduce((acc, ch, i) => {
    const n = Number(ch);
    if (i % 2 === 0) return acc + n;
    const doubled = n * 2;
    return acc + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return sum % 10 === 0;
}

export function ibanValid(input) {
  const iban = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = [...rearranged].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  // Piecewise mod 97 keeps numbers inside safe integer range.
  const remainder = numeric.match(/.{1,7}/g).reduce((acc, part) => Number(String(acc) + part) % 97, 0);
  return remainder === 1;
}

export function isIPv6(input) {
  const doubles = input.split('::').length - 1;
  if (doubles > 1) return false;
  const groups = input.split(':').filter((g) => g !== '');
  if (groups.length === 0 || !groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return doubles === 1 ? groups.length <= 7 : groups.length === 8;
}

const DATE_LIKE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;

function phoneValid(candidate) {
  const digits = digitsOnly(candidate);
  if (digits.length < 9 || digits.length > 15) return false;
  if (DATE_LIKE.test(candidate.trim())) return false;
  const hasFormatting = /^\+|[\s().-]/.test(candidate);
  return hasFormatting || digits.length >= 10;
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const DATE = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  '\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}',
  `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{4}`,
  `${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`,
].join('|');

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
].join('|');

// The 121 UK postcode areas. Checking the area rejects look-alikes such as
// "MP3 5MB"; inward codes never use C, I, K, M, O or V.
const UK_AREAS = [
  'AB', 'AL', 'BA', 'BB', 'BD', 'BH', 'BL', 'BN', 'BR', 'BS', 'BT', 'B', 'CA', 'CB', 'CF', 'CH', 'CM',
  'CO', 'CR', 'CT', 'CV', 'CW', 'DA', 'DD', 'DE', 'DG', 'DH', 'DL', 'DN', 'DT', 'DY', 'EC', 'EH', 'EN',
  'EX', 'E', 'FK', 'FY', 'GL', 'GU', 'GY', 'G', 'HA', 'HD', 'HG', 'HP', 'HR', 'HS', 'HU', 'HX', 'IG',
  'IM', 'IP', 'IV', 'JE', 'KA', 'KT', 'KW', 'KY', 'LA', 'LD', 'LE', 'LL', 'LN', 'LS', 'LU', 'L', 'ME',
  'MK', 'ML', 'M', 'NE', 'NG', 'NN', 'NP', 'NR', 'NW', 'N', 'OL', 'OX', 'PA', 'PE', 'PH', 'PL', 'PO',
  'PR', 'RG', 'RH', 'RM', 'SA', 'SE', 'SG', 'SK', 'SL', 'SM', 'SN', 'SO', 'SP', 'SR', 'SS', 'ST', 'SW',
  'SY', 'S', 'TA', 'TD', 'TF', 'TN', 'TQ', 'TR', 'TS', 'TW', 'UB', 'WA', 'WC', 'WD', 'WF', 'WN', 'WR',
  'WS', 'WV', 'W', 'YO', 'ZE',
].join('|');

// "5GB", "1TB": storage sizes that happen to fit the inward-code shape.
const notStorageSize = (value) => !/\d(?:GB|TB|PB)$/.test(value);

// Keyword-gated IDs must look like IDs: no lowercase, at least one digit.
// The regex is case-insensitive for the keyword only.
const looksLikeId = (value) => /^[A-Z0-9-]+$/.test(value) && /\d/.test(value);

const STREET_WORDS = '(?:[A-Z][a-z]+\\.?[ \\t]{1,3}){1,4}';
const COMPASS = '(?:[ \\t](?:NW|NE|SW|SE|N|S|E|W)\\b)?';

const DETECTORS = Object.freeze([
  {
    type: 'API_KEY',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/gd,
  },
  {
    type: 'API_KEY',
    regex: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/gd,
  },
  {
    type: 'API_KEY',
    regex: /\bBearer\s+([A-Za-z0-9._~+/=-]{12,})/gd,
    group: 1,
  },
  {
    // Prefix lets DB_PASSWORD / AWS_SECRET_ACCESS_KEY match; bounded to stay linear.
    type: 'API_KEY',
    regex: /\b[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["']?[ \t]{0,3}[:=][ \t]{0,3}["']?([^\s"',}]{6,})/gid,
    group: 1,
    requires: /[:=]/,
  },
  {
    // Quantifiers bounded to RFC limits so long dotted runs cannot backtrack quadratically.
    type: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b/gd,
    requires: /@/,
  },
  {
    type: 'URL',
    regex: /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gd,
  },
  {
    type: 'IBAN',
    regex: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gd,
    validate: ibanValid,
    shrink: true,
  },
  {
    type: 'CREDIT_CARD',
    regex: /\b(?:\d[ -]?){12,18}\d\b/gd,
    validate: luhnValid,
    shrink: true,
  },
  {
    type: 'SSN',
    regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/gd,
  },
  {
    // Only right after a birth keyword, so ordinary dates are left alone.
    type: 'DATE_OF_BIRTH',
    regex: new RegExp(`\\b(?:DOB|D\\.O\\.B\\.?|date of birth|birth ?date|born(?: on)?|birthday)(?![a-z])[ \\t:.-]{0,5}(${DATE})`, 'gid'),
    group: 1,
  },
  {
    // Keyword-gated so "the account manager" is not touched. Gaps are bounded:
    // two adjacent unbounded \s runs backtrack quadratically on long spaces.
    type: 'ID_NUMBER',
    regex: /\b(?:passport|account|acct|customer|client|member|employee|staff|student|patient|policy|case|claim|invoice|ticket|reference|ref|licen[cs]e|MRN|NHS|national id|ID)(?:[ \t]{1,3}(?:no\.?|number|num|#|id))?[ \t]{0,3}[:#.]?[ \t]{0,3}([A-Z0-9][A-Z0-9-]{3,24}[A-Z0-9])\b/gid,
    group: 1,
    validate: looksLikeId,
  },
  {
    type: 'ADDRESS',
    regex: new RegExp(`\\b\\d{1,5}[A-Z]?[ \\t]{1,3}${STREET_WORDS}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd|Terrace|Crescent|Parkway|Pkwy|Highway|Hwy)\\b${COMPASS}`, 'gd'),
  },
  {
    // "Drive", "Way", "Court"... are also product and software words
    // ("2 Google Drive accounts"), so these need a town after a comma.
    type: 'ADDRESS',
    regex: new RegExp(`\\b\\d{1,5}[A-Z]?[ \\t]{1,3}${STREET_WORDS}(?:Drive|Dr|Way|Court|Ct|Place|Pl|Close|Square|Sq)\\b${COMPASS}(?=,[ \\t]{0,3}[A-Z][a-z])`, 'gd'),
  },
  {
    type: 'POSTCODE',
    regex: new RegExp(`\\b(?:(?:${UK_AREAS})\\d[A-Z\\d]?|GIR) ?\\d[ABD-HJLNP-UW-Z]{2}\\b`, 'gd'),
    validate: notStorageSize,
  },
  {
    type: 'POSTCODE',
    regex: new RegExp(`\\b(?:${US_STATES})\\s+\\d{5}(?:-\\d{4})?\\b`, 'gd'),
  },
  {
    type: 'IP_ADDRESS',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b(?!\.\d)/gd,
  },
  {
    type: 'IP_ADDRESS',
    regex: /(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/gd,
    validate: isIPv6,
  },
  {
    type: 'PHONE',
    regex: /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,4}(?![\w])/gd,
    validate: phoneValid,
  },
]);

// Greedy regexes can swallow a trailing CVV, expiry or currency code, which
// then fails validation. Retry with trailing tokens dropped, longest first.
function* shrinkCandidates(value) {
  let candidate = value;
  yield candidate;
  for (;;) {
    const cut = candidate.search(/[ -][^ -]*$/);
    if (cut <= 0) return;
    candidate = candidate.slice(0, cut);
    yield candidate;
  }
}

function firstValid(detector, value) {
  if (!detector.validate) return value;
  const candidates = detector.shrink ? shrinkCandidates(value) : [value];
  for (const candidate of candidates) {
    if (detector.validate(candidate)) return candidate;
  }
  return null;
}

function* matchDetector(text, detector) {
  if (detector.requires && !detector.requires.test(text)) return;
  for (const match of text.matchAll(detector.regex)) {
    const group = detector.group ?? 0;
    if (match[group] === undefined) continue;
    const value = firstValid(detector, match[group]);
    if (value === null) continue;
    const [start] = match.indices[group];
    yield { start, end: start + value.length, type: detector.type, value, source: 'pattern' };
  }
}

// Returns pattern spans for every enabled type, sorted by start.
export function detectPatterns(text, enabledTypes) {
  if (!text) return [];
  const spans = DETECTORS
    .filter((d) => enabledTypes[d.type] === true)
    .flatMap((d) => [...matchDetector(text, d)]);
  return dropContained(spans);
}

const PRIORITY_ORDER = [
  'API_KEY', 'EMAIL', 'URL', 'IBAN', 'CREDIT_CARD', 'SSN', 'DATE_OF_BIRTH', 'ID_NUMBER',
  'ADDRESS', 'POSTCODE', 'IP_ADDRESS', 'PHONE',
];
const PRIORITY = (type) => PRIORITY_ORDER.indexOf(type);

const byStartThenWidest = (a, b) =>
  a.start - b.start || b.end - a.end || PRIORITY(a.type) - PRIORITY(b.type);

// Drops spans fully inside a wider (or equally wide, higher priority) span, so
// a card number is not also reported as a phone number. One sweep after
// sorting: the span reaching furthest right so far is the only container that
// needs checking. Partial overlaps are left for spans.js.
function dropContained(spans) {
  const sorted = [...spans].sort(byStartThenWidest);
  const kept = [];
  let cover = null;
  sorted.forEach((span) => {
    if (cover && cover.end >= span.end) return;
    kept.push(span);
    cover = span;
  });
  return kept;
}
