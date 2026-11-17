// Pattern detectors for structured sensitive data. Each detector has a regex
// (global, with the `d` flag so capture groups report offsets), an optional
// capture group to use as the span, and an optional validator.

import { fitsRegionalPlan } from './phone-plans.js';
import { columnSpans } from './columns.js';

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

const IPV4_LIKE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
// "2019-2024", "1999 2000 2001", "5000 6000", "1200 1500": years and round
// amounts in a row read like a Gulf number written 4-4, but are not one.
const YEAR = /^(?:19|20)\d\d$/;
function yearsOrRound(candidate) {
  const groups = candidate.trim().split(/[\s.-]+/);
  return groups.length >= 2 && groups.every((g) => g.length === 4)
    && (groups.every((g) => YEAR.test(g)) || groups.every((g) => g.endsWith('00')));
}

// "555-1234", "123 4567": a local number with no area code.
const SEVEN_DIGIT_LOCAL = /^\d{3}[ -]\d{4}$/;

function phoneValid(candidate) {
  const digits = digitsOnly(candidate);
  if (digits.length < 7 || digits.length > 15) return false;
  if (DATE_LIKE.test(candidate.trim()) || IPV4_LIKE.test(candidate.trim()) || yearsOrRound(candidate)) return false;
  // Exact check first: a number that fits a regional numbering plan.
  if (fitsRegionalPlan(candidate)) return true;
  if (SEVEN_DIGIT_LOCAL.test(candidate.trim())) return true;
  if (digits.length < 9) return false;
  const hasFormatting = /^\+|[\s().-]/.test(candidate);
  return hasFormatting || digits.length >= 10;
}

// After a phone word the number is a phone whatever its shape, so shorter
// local numbers ("phone 888999000") count too.
// Six digits is a full local number in Lebanon and in many towns.
function keywordPhoneValid(candidate) {
  const digits = digitsOnly(candidate);
  return digits.length >= 6 && digits.length <= 15 && !DATE_LIKE.test(candidate);
}

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const DATE = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  '\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}',
  `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{4}`,
  `\\d{1,2}[-/.]${MONTH}[-/.]\\d{2,4}`,
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

// Keyword-gated IDs must look like IDs: capitals and digits with at least
// one digit, or, typed in lowercase, at most 3 letters in front of 4+ digits
// ("passport no a39573324", "case cr-656436"). Words with a number in them
// ("python3", "handbook2024", "node18-alpine") never qualify.
const looksLikeId = (value) => (/^[A-Z0-9-]+$/.test(value)
  ? /\d/.test(value)
  : /^[A-Za-z]{0,3}-?\d{4,}[A-Za-z]?$/.test(value));

// Any casing ("221 baker street", "221 BAKER STREET"). Prose that reads like
// an address ("3 kids on the road", "2 hours down the street") has an
// everyday word between the number and the street word, which rules it out.
const STREET_WORDS_ANY_CASE = "(?:[A-Za-z][A-Za-z'-]+\\.?[ \\t]{1,3}){1,4}";
const NOT_STREET_NAMES = new Set([
  'the', 'a', 'an', 'on', 'of', 'to', 'in', 'at', 'for', 'and', 'or', 'with', 'my', 'our', 'your', 'his', 'her',
  'their', 'its', 'this', 'that', 'these', 'those', 'down', 'up', 'along', 'across', 'by', 'from', 'near', 'into',
  'onto', 'off', 'over', 'is', 'are', 'was', 'were', 'be', 'more', 'other', 'times', 'kids', 'children', 'people',
  'cars', 'hours', 'minutes', 'miles', 'km', 'days', 'weeks', 'years', 'blocks', 'lanes', 'ways', 'steps',
]);
const STREET_TYPE = /\s*\S+(?:\s+(?:NW|NE|SW|SE|N|S|E|W))?$/i;
const streetNameOk = (value) => value.replace(/^\d{1,5}[A-Za-z]?\s+/, '').replace(STREET_TYPE, '')
  .split(/\s+/).every((w) => !NOT_STREET_NAMES.has(w.toLowerCase().replace(/\.$/, '')));
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
    // Any case: an IBAN typed in lowercase is still that account.
    regex: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gid,
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
    regex: new RegExp(`(?:\\b(?:DOB|D\\.O\\.B\\.?|date of birth|birth ?date|born(?: on)?|birthday)|تاريخ الميلاد|تاريخ ميلاد|مواليد)(?![a-z])[ \\t:.-]{0,5}["'\u201c\u2018(]?(${DATE})`, 'gid'),
    group: 1,
  },
  {
    // Keyword-gated so "the account manager" is not touched. Gaps are bounded:
    // two adjacent unbounded \s runs backtrack quadratically on long spaces.
    type: 'ID_NUMBER',
    regex: /\b(?:passport|account|acct|customer|client|member|employee|staff|student|patient|policy|case|claim|invoice|ticket|reference|ref|licen[cs]e|MRN|NHS|national id|national number|civil id|iqama|CIN|CNIE|ID)(?:[ \t]{1,3}(?:no\.?|number|num|#|id|card))?[ \t]{0,3}[:#.]?[ \t]{0,3}([A-Z0-9][A-Z0-9-]{3,24}[A-Z0-9])\b/gid,
    group: 1,
    validate: looksLikeId,
  },
  {
    // Arabic ID words: الرقم القومي (Egypt), رقم الهوية, الرقم الوطني, الرقم
    // المدني (Kuwait), رقم الإقامة, جواز السفر. No \b: it only knows ASCII.
    type: 'ID_NUMBER',
    regex: /(?:الرقم القومي|رقم الهوية|الهوية الوطنية|الرقم الوطني|الرقم المدني|رقم الإقامة|رقم الاقامة|رقم جواز السفر|جواز السفر|رقم البطاقة)[ \t:#.]{0,4}([A-Za-z0-9][A-Za-z0-9-]{3,24}[A-Za-z0-9])\b/gd,
    group: 1,
    validate: looksLikeId,
  },
  {
    type: 'ADDRESS',
    regex: new RegExp(`\\b\\d{1,5}[A-Z]?[ \\t]{1,3}${STREET_WORDS_ANY_CASE}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd|Terrace|Crescent|Parkway|Pkwy|Highway|Hwy)\\b${COMPASS}`, 'gid'),
    validate: streetNameOk,
  },
  {
    // "Drive", "Way", "Court"... are also product and software words
    // ("2 Google Drive accounts"), so these need a town after a comma.
    type: 'ADDRESS',
    regex: new RegExp(`\\b\\d{1,5}[A-Z]?[ \\t]{1,3}${STREET_WORDS_ANY_CASE}(?:Drive|Dr|Way|Court|Ct|Place|Pl|Close|Square|Sq)\\b${COMPASS}(?=,[ \\t]{0,3}[A-Za-z]{2})`, 'gid'),
    validate: streetNameOk,
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
    // Groups of 1 to 5 digits: "+961 3 54 6390", "00212 6 12 34 56 78".
    // "(+961) 03 123 456": a country code in brackets is part of the number.
    regex: /(?<![\w+.])(?:\+\d{1,3}[\s.-]?|\(\+\d{1,3}\)[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,5}(?:[ \t.-]?\d{1,5}){1,5}(?![\w]|[.:]\d)/gd,
    validate: phoneValid,
    shrink: true,
    // "07701234567-07801234567": two numbers run together.
    split: true,
  },
  {
    // Keyword-gated like ID_NUMBER: "my phone number is 888999000",
    // "WhatsApp me on 964 7701 234". Gaps are bounded to stay linear.
    type: 'PHONE',
    // Also glued to the number: "Tel0501234567", "phone_0501234567", "mob.0501234567".
    regex: /\b(?:phone|mobile|mob|cell(?:phone)?|tel(?:ephone)?|whats ?app|viber|fax|call me)(?:\b|(?=\d)|_)[._]?(?:[ \t]{1,3}(?:no\.?|number|num|#))?(?:[ \t]{1,3}(?:is|was))?(?:[ \t]{1,3}(?:me[ \t]{1,3})?(?:on|at))?[ \t]{0,3}[:#]?[ \t]{0,3}(\+?\d(?:[ .-]?\d){4,14})(?!\w)/gid,
    group: 1,
    validate: keywordPhoneValid,
  },
  {
    // Arabic phone words: هاتف، جوال، موبايل، رقم، واتساب (no \b: JS word
    // boundaries only know ASCII letters).
    type: 'PHONE',
    regex: /(?:هاتف|جوال|الجوال|موبايل|الموبايل|رقم|واتساب|تلفون)[^\d\n+]{0,12}(\+?\d(?:[ .-]?\d){4,14})(?!\w)/gd,
    group: 1,
    validate: keywordPhoneValid,
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

// Two valid values joined by one separator ("0770.../0780...", "...-..."),
// as [offset, value] pairs; null when no split gives two valid halves.
function splitPair(detector, value) {
  if (!detector.split || detector.validate(value)) return null;
  for (const m of value.matchAll(/[ \t.-]/g)) {
    const left = value.slice(0, m.index);
    const right = value.slice(m.index + 1);
    if (detector.validate(left) && detector.validate(right)) return [[0, left], [m.index + 1, right]];
  }
  return null;
}

function* matchDetector(text, detector) {
  if (detector.requires && !detector.requires.test(text)) return;
  for (const match of text.matchAll(detector.regex)) {
    const group = detector.group ?? 0;
    if (match[group] === undefined) continue;
    const [start] = match.indices[group];
    const pair = splitPair(detector, match[group]);
    if (pair) {
      for (const [offset, value] of pair) {
        yield { start: start + offset, end: start + offset + value.length, type: detector.type, value, source: 'pattern' };
      }
      continue;
    }
    const value = firstValid(detector, match[group]);
    if (value === null) continue;
    yield { start, end: start + value.length, type: detector.type, value, source: 'pattern' };
  }
}

// Returns pattern spans for every enabled type, sorted by start.
export function detectPatterns(text, enabledTypes) {
  if (!text) return [];
  const spans = DETECTORS
    .filter((d) => enabledTypes[d.type] === true)
    .flatMap((d) => [...matchDetector(text, d)]);
  return dropContained([...spans, ...columnSpans(text, enabledTypes)]);
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
