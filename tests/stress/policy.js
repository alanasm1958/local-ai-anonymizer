// What counts as a failure. Each rule maps to a scope decision; change the
// answer here and every affected case flips. Defaults are the recommended
// answers from the 2026-11-07 scoping (Alan asked to build the suite before
// confirming them one by one; see test-results/REPORT.md).

export const DECISIONS = Object.freeze({
  arabicScriptNames: 'known_gap', // English-only model for now; measured, not failed
  regionalAddresses: 'known_gap',
  loneLowercaseFirstName: 'known_gap', // lone first names must be caught when capitalized
  nameSplitAcrossLines: 'known_gap', // no entity spans a line break (design rule)
  idWithoutKeyword: 'known_gap',
  phoneInWords: 'known_gap',
  obfuscatedEmail: 'known_gap',
  shortLocalNoKeyword: 'known_gap', // a bare 6-digit local number reads like any number
  ambiguousNumbers: 'may_hide', // policy: hide when unsure, so hiding is fine
});

// Returns { expected, reason } for a case under construction.
export function expectationFor({ family, variant, subtype, value = '', lead = '' }) {
  const gap = (key) => ({ expected: DECISIONS[key], reason: key });
  if (family === 'phone' && subtype?.endsWith('subscriber-only') && !lead.trim() && value.replace(/\D/g, '').length < 7) {
    return gap('shortLocalNoKeyword');
  }
  switch (family) {
    case 'person-arabic-script': return gap('arabicScriptNames');
    case 'address-regional': return gap('regionalAddresses');
    case 'person-linebreak': return gap('nameSplitAcrossLines');
    case 'id-no-keyword': return gap('idWithoutKeyword');
    case 'phone-words': return gap('phoneInWords');
    case 'email-obfuscated': return gap('obfuscatedEmail');
    case 'ambiguous-number': return gap('ambiguousNumbers');
    case 'negative': return { expected: 'must_keep', reason: 'ordinary text' };
    case 'person-first':
      return variant === 'title' || variant === 'first' || subtype === 'with-title'
        ? { expected: 'must_catch', reason: 'capitalized first name' }
        : gap('loneLowercaseFirstName');
    default: return { expected: 'must_catch', reason: 'in scope' };
  }
}
