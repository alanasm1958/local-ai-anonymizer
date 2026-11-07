// Numbering plans for the Middle East and North Africa: the "exact check"
// step for phone numbers. A digit run that fits a country's plan, written the
// local way (trunk 0 + national number, or the bare national number where a
// country has no trunk prefix) or the international way (+cc / 00cc, with or
// without "(0)"), is a phone number whatever its spacing. This is what lets
// 8-digit local numbers (Lebanon, the Gulf, Tunisia) through the rule, where
// the generic rule needs 10 digits.
//
// Each plan: country code, trunk prefix ('' if none), and national number
// patterns (mobile and fixed lines, digits only).

export const PHONE_PLANS = Object.freeze([
  { country: 'EG', cc: '20', trunk: '0', nsn: /^(?:1[0125]\d{8}|2\d{8}|3\d{7,8}|[4-9]\d{7,8})$/ },
  { country: 'JO', cc: '962', trunk: '0', nsn: /^(?:7[789]\d{7}|[2356]\d{7})$/ },
  { country: 'LB', cc: '961', trunk: '0', nsn: /^(?:3\d{6}|7[01689]\d{6}|81\d{6}|[1-9]\d{6})$/ },
  { country: 'PS', cc: '970', trunk: '0', nsn: /^(?:5[69]\d{7}|[2489]\d{7})$/ },
  { country: 'SY', cc: '963', trunk: '0', nsn: /^(?:9\d{8}|[1-5]\d{6,8})$/ },
  { country: 'MA', cc: '212', trunk: '0', nsn: /^[5-8]\d{8}$/ },
  { country: 'DZ', cc: '213', trunk: '0', nsn: /^(?:[567]\d{8}|[2-4]\d{7})$/ },
  { country: 'TN', cc: '216', trunk: '', nsn: /^[2-579]\d{7}$/ },
  { country: 'LY', cc: '218', trunk: '0', nsn: /^(?:9[1-6]\d{7}|[2-8]\d{7,8})$/ },
  { country: 'YE', cc: '967', trunk: '0', nsn: /^(?:7[01378]\d{7}|[1-7]\d{6,7})$/ },
  { country: 'KW', cc: '965', trunk: '', nsn: /^[124569]\d{7}$/ },
  { country: 'AE', cc: '971', trunk: '0', nsn: /^(?:5[0-8]\d{7}|[2-79]\d{7})$/ },
  { country: 'IQ', cc: '964', trunk: '0', nsn: /^(?:7[3-9]\d{8}|1\d{7}|[2-6]\d{7,8})$/ },
  { country: 'SA', cc: '966', trunk: '0', nsn: /^(?:5\d{8}|1[1-7]\d{7})$/ },
  { country: 'OM', cc: '968', trunk: '', nsn: /^[279]\d{7}$/ },
  { country: 'QA', cc: '974', trunk: '', nsn: /^[3-7]\d{7}$/ },
  { country: 'BH', cc: '973', trunk: '', nsn: /^[136]\d{7}$/ },
  { country: 'SD', cc: '249', trunk: '0', nsn: /^[19]\d{8}$/ },
]);

const PLAN_BY_CC = new Map(PHONE_PLANS.map((p) => [p.cc, p]));

// International: "+cc", "00cc" or a bare "cc" in front of the national
// number, an optional "(0)" or trunk 0 after the code.
function fitsInternational(digits) {
  for (const len of [3, 2]) {
    const plan = PLAN_BY_CC.get(digits.slice(0, len));
    if (!plan) continue;
    const rest = digits.slice(len);
    if (plan.nsn.test(rest)) return true;
    if (plan.trunk && rest.startsWith(plan.trunk) && plan.nsn.test(rest.slice(plan.trunk.length))) return true;
  }
  return false;
}

function fitsLocal(digits) {
  return PHONE_PLANS.some((p) => (p.trunk
    ? digits.startsWith(p.trunk) && p.nsn.test(digits.slice(p.trunk.length))
    : p.nsn.test(digits)));
}

// `written`: the candidate as it appears (with +, 00, spaces...).
// Bare-digit local numbers of 8 digits are left to the generic rule unless
// written with a separator: "50123456" alone is as likely an order number.
export function fitsRegionalPlan(written) {
  const digits = written.replace(/\D/g, '');
  const trimmed = written.trim();
  if (trimmed.startsWith('+')) return fitsInternational(digits);
  if (digits.startsWith('00')) return fitsInternational(digits.slice(2));
  const formatted = /[\s().-]/.test(trimmed);
  if (!formatted && digits.length < 9) return false;
  return fitsLocal(digits) || (digits.length >= 10 && fitsInternational(digits));
}
