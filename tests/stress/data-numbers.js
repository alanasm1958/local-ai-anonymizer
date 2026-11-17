// Numbers across the region: phones built from each country's real numbering
// plan, national IDs, IBANs with valid check digits, Luhn-valid cards, dates
// of birth, and fake secrets generated at run time (never stored in the repo).

import { rngFor, luhnCheckDigit, makeIban } from './rng.js';

// trunk: the leading 0 used inside the country ('' where there is none).
// Each line: NSN prefixes and how many subscriber digits follow.
export const PHONE_PLANS = Object.freeze({
  EG: { cc: '20', trunk: '0', mobile: [['10', '11', '12', '15'], 8], landline: [['2'], 8] },
  JO: { cc: '962', trunk: '0', mobile: [['77', '78', '79'], 7], landline: [['6'], 7] },
  LB: { cc: '961', trunk: '0', mobile: [['3'], 6], landline: [['1'], 6] },
  PS: { cc: '970', trunk: '0', mobile: [['59', '56'], 7], landline: [['2', '9'], 7] },
  MA: { cc: '212', trunk: '0', mobile: [['6', '7'], 8], landline: [['522', '537'], 6] },
  TN: { cc: '216', trunk: '', mobile: [['2', '5', '9'], 7], landline: [['71'], 6] },
  YE: { cc: '967', trunk: '0', mobile: [['77', '73', '71'], 7], landline: [['1'], 6] },
  KW: { cc: '965', trunk: '', mobile: [['5', '6', '9'], 7], landline: [['2'], 7] },
  AE: { cc: '971', trunk: '0', mobile: [['50', '52', '55', '56'], 7], landline: [['4', '2'], 7] },
  IQ: { cc: '964', trunk: '0', mobile: [['750', '751', '770', '771', '780', '781'], 7], landline: [['1', '66'], 7] },
  SA: { cc: '966', trunk: '0', mobile: [['50', '53', '55', '56'], 7], landline: [['11', '12'], 7] },
  OM: { cc: '968', trunk: '', mobile: [['9', '7'], 7], landline: [['24'], 6] },
  QA: { cc: '974', trunk: '', mobile: [['3', '5', '6', '7'], 7], landline: [['44'], 6] },
  BH: { cc: '973', trunk: '', mobile: [['3'], 7], landline: [['17'], 6] },
});

const group = (digits, sep = ' ') => {
  // Area/prefix part stays whole, the rest goes in blocks of 3 then 4 (or 3/3).
  // 6-digit subscriber parts (Lebanon, Tunisia, Gulf landlines) go 3/3.
  const parts = digits.length > 8 ? [digits.slice(0, -7), digits.slice(-7, -4), digits.slice(-4)]
    : digits.length === 6 ? [digits.slice(0, 3), digits.slice(3)]
      : [digits.slice(0, -4), digits.slice(-4)];
  return parts.filter(Boolean).join(sep);
};

export function makePhone(country, line, rng) {
  const plan = PHONE_PLANS[country];
  const [prefixes, len] = plan[line];
  const prefix = rng.pick(prefixes);
  const nsn = `${prefix}${rng.digits(len)}`;
  return { country, line, cc: plan.cc, trunk: plan.trunk, prefix, nsn, local: `${plan.trunk}${nsn}` };
}

// Every way people write the same number. Keys are the format names in reports.
export function phoneFormats(p) {
  const rest = p.nsn.slice(p.prefix.length);
  const formats = {
    'local-spaced': `${p.trunk}${p.prefix} ${group(rest)}`,
    'local-compact': p.local,
    'local-dashed': `${p.trunk}${p.prefix}-${group(rest, '-')}`,
    'local-dotted': `${p.trunk}${p.prefix}.${group(rest, '.')}`,
    'intl-plus-spaced': `+${p.cc} ${p.prefix} ${group(rest)}`,
    'intl-plus-compact': `+${p.cc}${p.nsn}`,
    'intl-00': `00${p.cc} ${p.prefix} ${group(rest)}`,
    'intl-no-plus': `${p.cc}${p.nsn}`,
    'intl-dashed': `+${p.cc}-${p.prefix}-${group(rest, '-')}`,
    ext: `${p.trunk}${p.prefix} ${group(rest)} ext. 12`,
    'whatsapp-link': `wa.me/${p.cc}${p.nsn}`,
    'subscriber-only': group(rest),
  };
  if (p.trunk) {
    formats['local-paren'] = `(${p.trunk}${p.prefix}) ${group(rest)}`;
    formats['intl-plus-trunk'] = `+${p.cc} (0) ${p.prefix} ${group(rest)}`;
  }
  return formats;
}

export const PHONE_LEADS = Object.freeze(['', 'phone: ', 'mobile ', 'WhatsApp ', 'call me on ', 'tel. ', 'رقم الهاتف ', 'Cell: ']);

const two = (n) => String(n).padStart(2, '0');
const birthPart = (rng, yearMin, yearMax) => `${two(rng.int(yearMin, yearMax) % 100)}${two(rng.int(1, 12))}${two(rng.int(1, 28))}`;

// National and official ID numbers. keyword: the word people put before it.
export function makeIds(rng) {
  const saudi = `${rng.pick(['1', '2'])}${rng.digits(8)}`;
  const emirates = `784${rng.int(1970, 2005)}${rng.digits(7)}`;
  return [
    { country: 'EG', kind: 'national-id', keyword: 'national ID', value: `2${birthPart(rng, 1970, 1999)}${two(rng.int(1, 35))}${rng.digits(4)}${rng.digits(1)}` },
    { country: 'JO', kind: 'national-number', keyword: 'national number', value: `9${two(rng.int(70, 99))}${rng.digits(7)}` },
    { country: 'SA', kind: 'national-id', keyword: 'ID number', value: `${saudi}${luhnCheckDigit(saudi)}` },
    { country: 'SA', kind: 'iqama', keyword: 'iqama', value: `2${rng.digits(9)}` },
    { country: 'AE', kind: 'emirates-id', keyword: 'Emirates ID', value: `${emirates.slice(0, 3)}-${emirates.slice(3, 7)}-${emirates.slice(7)}-${luhnCheckDigit(emirates)}` },
    { country: 'KW', kind: 'civil-id', keyword: 'civil ID', value: `2${birthPart(rng, 1970, 1999)}${rng.digits(5)}` },
    { country: 'IQ', kind: 'national-card', keyword: 'national ID no.', value: `19${rng.digits(10)}` },
    { country: 'MA', kind: 'cin', keyword: 'CIN', value: `${rng.pick(['BE', 'AB', 'J', 'BK'])}${rng.digits(6)}` },
    { country: 'TN', kind: 'cin', keyword: 'CIN', value: `0${rng.digits(7)}` },
    { country: 'EG', kind: 'passport', keyword: 'passport no', value: `A${rng.digits(8)}` },
    { country: 'JO', kind: 'passport', keyword: 'Passport #', value: `N${rng.digits(6)}` },
    { country: 'XX', kind: 'student-id', keyword: 'student ID', value: `${rng.int(2019, 2025)}${rng.digits(5)}` },
    { country: 'XX', kind: 'employee-id', keyword: 'employee no.', value: `E-${rng.digits(5)}` },
    { country: 'XX', kind: 'case-number', keyword: 'case #', value: `CR-${rng.digits(6)}` },
  ];
}

export const ID_KEYWORDS_AR = Object.freeze(['الرقم القومي', 'رقم الهوية', 'الرقم المدني']);

// [country, bank letters or '', digits after them] so the total matches the
// country's IBAN length.
const IBAN_SPECS = Object.freeze([
  ['EG', '', 25], ['JO', 'ARAB', 22], ['LB', '', 24], ['PS', 'PALS', 21], ['TN', '', 20], ['KW', 'NBOK', 22],
  ['AE', '', 19], ['IQ', 'NBIQ', 15], ['SA', '', 20], ['QA', 'QNBA', 21], ['BH', 'BMAG', 14],
]);

export function makeIbans(rng) {
  return IBAN_SPECS.map(([country, bank, n]) => ({ country, value: makeIban(country, `${bank}${rng.digits(n)}`) }));
}

export const ibanFormats = (iban) => ({
  compact: iban,
  grouped: iban.match(/.{1,4}/g).join(' '),
  lowercase: iban.toLowerCase(),
});

const CARD_SPECS = Object.freeze([['visa', '4', 16], ['mastercard', '53', 16], ['amex', '37', 15], ['meeza', '507803', 16], ['mada', '588845', 16]]);

export function makeCards(rng) {
  return CARD_SPECS.map(([brand, prefix, len]) => {
    const partial = `${prefix}${rng.digits(len - prefix.length - 1)}`;
    return { brand, value: `${partial}${luhnCheckDigit(partial)}` };
  });
}

export const cardFormats = (n) => ({
  compact: n,
  spaced: n.length === 15 ? `${n.slice(0, 4)} ${n.slice(4, 10)} ${n.slice(10)}` : n.match(/.{4}/g).join(' '),
  dashed: n.match(/.{1,4}/g).join('-'),
  'with-expiry-cvv': `${n.match(/.{1,4}/g).join(' ')} exp 08/27 cvv 413`,
});

export const DOB_KEYWORDS = Object.freeze(['DOB', 'D.O.B.', 'date of birth', 'born on', 'birthday', 'Birth date:', 'تاريخ الميلاد']);

export function dobFormats(rng) {
  const y = rng.int(1960, 2005);
  const m = rng.int(1, 12);
  const d = rng.int(10, 28);
  const mon = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
  return {
    'dd/mm/yyyy': `${d}/${two(m)}/${y}`,
    iso: `${y}-${two(m)}-${d}`,
    'd month yyyy': `${d} ${mon} ${y}`,
    'month d, yyyy': `${mon} ${d}, ${y}`,
    'dd-mon-yyyy': `${d}-${mon.slice(0, 3)}-${y}`,
    'dd.mm.yyyy': `${d}.${two(m)}.${y}`,
  };
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_NUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Fake secrets. body: the part that must not survive.
export function makeSecrets(rng) {
  const s = (n) => rng.chars(n, ALNUM);
  const items = [
    ['openai', `sk-proj-${s(40)}`],
    ['anthropic', `sk-ant-${s(40)}`],
    ['aws', `AKIA${rng.chars(16, UPPER_NUM)}`],
    ['github', `ghp_${s(36)}`],
    ['slack', `xoxb-${rng.digits(11)}-${s(24)}`],
    ['google', `AIza${s(35)}`],
    ['stripe-test', `sk_test_${s(24)}`],
    ['jwt', `eyJ${s(20)}.${s(30)}.${s(24)}`],
  ];
  return items.map(([kind, body]) => ({ kind, body, text: body }));
}

export function makeSecretBlocks(rng) {
  const s = (n) => rng.chars(n, ALNUM);
  const pw = `Qz${s(10)}!`;
  const bearer = s(32);
  const apiKey = s(28);
  return [
    { kind: 'env-block', body: pw, text: `DB_HOST=db.internal\nDB_PASSWORD=${pw}\nDB_PORT=5432` },
    { kind: 'bearer', body: bearer, text: `Authorization: Bearer ${bearer}` },
    { kind: 'json-key', body: apiKey, text: `{"api_key": "${apiKey}", "region": "me-south-1"}` },
    { kind: 'password-pair', body: pw, text: `password: ${pw}` },
  ];
}

export const IPS = Object.freeze(['10.24.7.193', '192.168.14.27', '172.16.200.4', '2001:db8:85a3::8a2e:370:7334', 'fe80::1ff:fe23:4567:890a']);

export const PHONE_WORDS = Object.freeze([
  'zero seven seven zero one two three four five six seven',
  'oh one oh, one two three, four five six seven',
  'صفر سبعة سبعة صفر واحد اثنان ثلاثة',
]);

export const rngNumbers = (name) => rngFor(`numbers:${name}`);
