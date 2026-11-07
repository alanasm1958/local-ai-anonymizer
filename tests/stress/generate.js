// Builds the stress cases: every value family through casing variants,
// contexts and Unicode traps. Pure and seeded: same code, same cases.
//
// A case: { id, family, subtype, variant, context, trap, text, background,
//   secrets: [{ kind, value }], keep: [string], expected, reason }
// background is the text with the value blanked out, so the oracle ignores
// digits and words the context itself contains.

import { CONTEXTS, contextById, VARIANTS, TRAPS, TRAP_CONTEXTS } from './contexts.js';
import { expectationFor } from './policy.js';
import * as P from './data-people.js';
import * as N from './data-numbers.js';
import { WESTERN_ADDRESSES, REGIONAL_ADDRESSES, NEGATIVES, AMBIGUOUS_NUMBERS } from './data-other.js';

const SLOT = '\u0001';
const ALL_VARIANTS = Object.keys(VARIANTS);
const CASE_VARIANTS = ['title', 'lower', 'upper'];
const NUMERIC_KINDS = new Set(['digits']);

function makeCase(spec) {
  const variant = VARIANTS[spec.variant];
  const shape = (s) => (variant.scope === 'all' ? variant.apply(s) : s);
  const ctx = contextById(spec.context);
  const trap = spec.trap ? TRAPS[spec.trap].apply : (s) => s;
  const cased = variant.apply(spec.value);
  const frame = shape(spec.frame ?? SLOT);
  const lead = shape(spec.lead ?? '');
  const fill = (inner) => shape(ctx.t.replaceAll('{X}', SLOT)).replaceAll(SLOT, `${lead}${frame.replace(SLOT, inner)}`);
  const secretValue = spec.secret ? variant.apply(spec.secret) : cased;
  return {
    family: spec.family,
    subtype: spec.subtype ?? '',
    variant: spec.variant,
    context: spec.context,
    trap: spec.trap ?? '',
    text: fill(trap(cased)),
    background: fill(' '),
    secrets: spec.kind === 'none' ? [] : [{ kind: spec.kind, value: secretValue }],
    keep: [...ctx.keep.map(shape), ...(spec.keep ?? []).map(shape)],
    ...expectationFor(spec),
  };
}

// Every variant x context once, values in rotation, then the traps.
function grid(base, values, { variants = ALL_VARIANTS, rng } = {}) {
  const combos = variants.flatMap((variant) => CONTEXTS.map((c) => ({ variant, context: c.id })));
  const numeric = NUMERIC_KINDS.has(base.kind);
  const traps = Object.entries(TRAPS).filter(([, t]) => numeric || !t.onlyNumbers).map(([name]) => name);
  const trapCombos = traps.flatMap((trap) => TRAP_CONTEXTS.map((context) => ({ variant: 'title', context, trap })));
  return [...combos, ...trapCombos].map((combo, i) => {
    const item = values[i % values.length];
    const extra = typeof item === 'string' ? { value: item } : item;
    return makeCase({ ...base, ...extra, ...combo, lead: base.lead ?? (rng ? rng.pick(base.leads ?? ['']) : '') });
  });
}

const cross = (values, variants, contexts, fn) =>
  values.flatMap((value, i) => variants.flatMap((variant) => contexts.map((context) => fn(value, variant, context, i))));

function people() {
  const full = { family: 'person-full', kind: 'words' };
  const first = P.FULL_NAMES.map(P.firstName);
  const titled = P.FULL_NAMES.map((n, i) => {
    const title = P.TITLES[i % P.TITLES.length];
    const name = i % 2 ? P.lastName(n) : n;
    return { value: `${title} ${name}`, secret: name };
  });
  const wordNames = P.WORD_NAMES.map((n) => ({ value: `Mr. ${n}`, secret: n, subtype: 'word-name' }));
  const shapes = P.FULL_NAMES.slice(0, 12).flatMap((n) => [
    { value: `${n}'s`, secret: n, subtype: 'possessive' },
    { value: `${P.firstName(n)[0]}. ${P.lastName(n)}`, secret: P.lastName(n), subtype: 'initial' },
    { value: `${P.lastName(n)}, ${P.firstName(n)}`, secret: n, subtype: 'reversed' },
  ]);
  return [
    ...grid(full, P.FULL_NAMES),
    ...cross(P.FULL_NAMES, ALL_VARIANTS, ['middle', 'table', 'csv'], (value, variant, context) =>
      makeCase({ ...full, subtype: 'every-name', value, variant, context })),
    ...grid({ family: 'person-first', kind: 'words' }, first),
    ...grid({ family: 'person-titled', kind: 'words', subtype: 'with-title' }, [...titled, ...wordNames], { variants: CASE_VARIANTS }),
    ...cross(shapes, ['title', 'lower'], ['middle', 'colon', 'table', 'json', 'signature', 'start'], (s, variant, context) =>
      makeCase({ family: 'person-shape', kind: 'words', ...s, variant, context })),
    ...cross(P.ARABIC_SCRIPT_NAMES, ['title'], ['alone', 'middle', 'colon', 'table', 'json', 'signature'], (value, variant, context) =>
      makeCase({ family: 'person-arabic-script', kind: 'words', value, variant, context })),
    ...cross(P.FULL_NAMES.slice(0, 5), ['title'], ['signature', 'alone'], (n, variant, context) =>
      makeCase({ family: 'person-linebreak', kind: 'words', value: n.replace(' ', '\n'), secret: n, variant, context })),
  ];
}

function orgsPlacesEmails() {
  const loc = { family: 'location', kind: 'words', frame: `the office in ${SLOT}` };
  return [
    ...grid({ family: 'organization', kind: 'words', frame: `our partner ${SLOT}` }, P.ORGS),
    ...grid(loc, P.LOCATIONS),
    ...cross(P.LOCATIONS, CASE_VARIANTS, ['middle'], (value, variant, context) => makeCase({ ...loc, subtype: 'every-place', value, variant, context })),
    ...grid({ family: 'email', kind: 'email' }, P.EMAILS),
    ...cross(P.OBFUSCATED_EMAILS, ['title'], ['middle', 'colon', 'signature'], (value, variant, context) =>
      makeCase({ family: 'email-obfuscated', kind: 'email', value, variant, context })),
  ];
}

function phones() {
  const rng = N.rngNumbers('phones');
  const countries = Object.keys(N.PHONE_PLANS);
  const matrix = countries.flatMap((country) => ['mobile', 'landline', 'mobile', 'landline'].flatMap((line, round) => {
    const formats = N.phoneFormats(N.makePhone(country, line, rng));
    return Object.entries(formats).map(([format, value], i) => makeCase({
      family: 'phone', subtype: `${country}/${line}/${format}`, kind: 'digits', value,
      variant: 'title', context: CONTEXTS[(i + round * 5) % CONTEXTS.length].id,
      lead: N.PHONE_LEADS[(i + round) % N.PHONE_LEADS.length],
    }));
  }));
  const arabicDigits = countries.map((country) => makeCase({
    family: 'phone', subtype: `${country}/mobile/arabic-indic`, kind: 'digits',
    value: N.phoneFormats(N.makePhone(country, 'mobile', rng))['local-spaced'], variant: 'title', context: 'middle', trap: 'arabic-indic-digits',
  }));
  const gridValues = countries.map((c) => {
    const f = N.phoneFormats(N.makePhone(c, 'mobile', rng));
    return { value: rng.pick([f['local-spaced'], f['intl-plus-spaced'], f['local-compact']]), subtype: `${c}/mobile/grid` };
  });
  const words = cross(N.PHONE_WORDS, ['title'], ['middle', 'colon'], (value, variant, context) =>
    makeCase({ family: 'phone-words', kind: 'words', value, variant, context, lead: 'my number is ' }));
  return [...matrix, ...arabicDigits, ...grid({ family: 'phone', kind: 'digits', leads: N.PHONE_LEADS }, gridValues, { variants: CASE_VARIANTS, rng }), ...words];
}

function ids() {
  const rng = N.rngNumbers('ids');
  const items = N.makeIds(rng);
  const withKeyword = cross(items, CASE_VARIANTS, ['middle', 'colon', 'table', 'json', 'csv', 'signature'], (id, variant, context) =>
    makeCase({ family: 'id', subtype: `${id.country}/${id.kind}`, kind: 'digits', value: id.value, lead: `${id.keyword} `, variant, context }));
  const arabicKeyword = cross(items.slice(0, 6), ['title'], ['middle'], (id, variant, context, i) =>
    makeCase({ family: 'id', subtype: `${id.country}/${id.kind}/arabic-keyword`, kind: 'digits', value: id.value, lead: `${N.ID_KEYWORDS_AR[i % 3]} `, variant, context }));
  const noKeyword = cross(items, ['title'], ['middle', 'table'], (id, variant, context) =>
    makeCase({ family: 'id-no-keyword', subtype: `${id.country}/${id.kind}`, kind: 'digits', value: id.value, variant, context }));
  return [...withKeyword, ...arabicKeyword, ...noKeyword];
}

function money() {
  const rng = N.rngNumbers('money');
  const ibanLeads = ['', 'IBAN: ', 'account '];
  const ibans = N.makeIbans(rng).flatMap(({ country, value }, i) => Object.entries(N.ibanFormats(value)).flatMap(([format, v]) =>
    ['middle', 'table'].map((context) => makeCase({ family: 'iban', subtype: `${country}/${format}`, kind: 'digits', value: v, variant: 'title', context, lead: ibanLeads[i % 3] }))));
  const cardLeads = ['', 'card ', 'Card number: '];
  const cards = N.makeCards(rng).flatMap(({ brand, value }, i) => Object.entries(N.cardFormats(value)).flatMap(([format, v]) =>
    ['middle', 'colon', 'json'].map((context) => makeCase({ family: 'card', subtype: `${brand}/${format}`, kind: 'digits', value: v, secret: value, variant: 'title', context, lead: cardLeads[i % 3] }))));
  return [...ibans, ...cards];
}

function dobs() {
  const rng = N.rngNumbers('dob');
  const matrix = N.DOB_KEYWORDS.flatMap((keyword, k) => Object.entries(N.dobFormats(rng)).map(([format, value], i) => makeCase({
    family: 'dob', subtype: `${keyword}/${format}`, kind: 'digits', value, lead: `${keyword} `,
    variant: CASE_VARIANTS[(k + i) % 3], context: CONTEXTS[(k * 6 + i) % CONTEXTS.length].id,
  })));
  const values = Object.values(N.dobFormats(rng)).map((value) => ({ value, lead: 'DOB ' }));
  return [...matrix, ...grid({ family: 'dob', kind: 'digits', lead: 'date of birth ' }, values, { variants: CASE_VARIANTS })];
}

function secretsAndMachines() {
  const rng = N.rngNumbers('secrets');
  const keys = cross(N.makeSecrets(rng), ['title'], ['alone', 'middle', 'colon', 'json', 'adjacent'], (s, variant, context) =>
    makeCase({ family: 'secret', subtype: s.kind, kind: 'chars', value: s.text, secret: s.body, variant, context }));
  const blocks = cross(N.makeSecretBlocks(rng), ['title'], ['alone', 'bullet'], (s, variant, context) =>
    makeCase({ family: 'secret', subtype: s.kind, kind: 'chars', value: s.text, secret: s.body, variant, context }));
  const ipLeads = ['', 'server ', 'login failed from '];
  const ips = cross(N.IPS, CASE_VARIANTS, ['alone', 'middle', 'colon', 'table', 'json', 'csv'], (value, variant, context, i) =>
    makeCase({ family: 'ip', kind: 'exact', value, variant, context, lead: ipLeads[i % 3] }));
  return [...keys, ...blocks, ...ips];
}

function addressesAndNegatives() {
  const western = cross(WESTERN_ADDRESSES, CASE_VARIANTS, ['alone', 'middle', 'colon', 'table', 'json', 'signature'], (value, variant, context) =>
    makeCase({ family: 'address-western', kind: 'words', value, variant, context }));
  const regional = cross(REGIONAL_ADDRESSES, ['title'], ['middle', 'colon', 'signature'], (value, variant, context) =>
    makeCase({ family: 'address-regional', kind: 'words', value, variant, context }));
  const negatives = cross(NEGATIVES, CASE_VARIANTS, ['alone'], (n, variant, context) =>
    makeCase({ family: 'negative', subtype: n.id, kind: 'none', value: n.text, keep: n.keep, variant, context }));
  const ambiguous = cross(AMBIGUOUS_NUMBERS, ['title'], ['alone', 'table'], (n, variant, context) =>
    makeCase({ family: 'ambiguous-number', subtype: n.id, kind: 'digits', value: n.text, secret: n.value, variant, context }));
  return [...western, ...regional, ...negatives, ...ambiguous];
}

export function generateCases() {
  const all = [...people(), ...orgsPlacesEmails(), ...phones(), ...ids(), ...money(), ...dobs(), ...secretsAndMachines(), ...addressesAndNegatives()];
  return Object.freeze(all.map((c, i) => Object.freeze({ id: `X${String(i + 1).padStart(4, '0')}`, ...c })));
}
