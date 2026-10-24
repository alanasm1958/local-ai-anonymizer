// Once a full name is known ("Maria Gonzalez"), its parts on their own
// ("Maria said...", "Gonzalez agreed") are the same person. Small models often
// miss a lone first name, so these get the full name's placeholder.

const MIN_PART_LENGTH = 3;

// Given names that are also everyday words; replacing every "Will" or "May"
// would wreck ordinary sentences.
const COMMON_WORD_NAMES = new Set([
  'will', 'may', 'mark', 'grace', 'hope', 'joy', 'faith', 'bill', 'rose', 'june', 'april', 'august',
  'art', 'guy', 'pat', 'sue', 'rob', 'jack', 'frank', 'ray', 'dawn', 'summer', 'autumn', 'chase',
  'hunter', 'lane', 'drew', 'dean', 'miles', 'page', 'mason', 'baker', 'carter', 'young', 'white',
  'black', 'brown', 'green', 'long', 'little', 'king', 'price', 'wood', 'hill', 'bell', 'rich',
  'van', 'von', 'der', 'den', 'del', 'della', 'bin', 'ibn', 'abu', 'mrs', 'miss', 'sir',
]);

const normalizeName = (name) => name.trim().replace(/\s+/g, ' ');
const sameName = (a, b) => normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();

const isUsablePart = (part) =>
  part.length >= MIN_PART_LENGTH
  && /^\p{Lu}[\p{L}'’-]*$/u.test(part)
  && !COMMON_WORD_NAMES.has(part.toLowerCase());

export function nameParts(fullName) {
  const words = normalizeName(fullName).split(' ').map((w) => w.replace(/[.,]+$/, ''));
  return words.length < 2 ? [] : words.filter(isUsablePart);
}

// Map of name part -> the full name it belongs to, or null when two different
// people share it ("Maria" Gonzalez and "Maria" Lopez): ambiguous, skipped.
export function partOwners(fullNames) {
  const owners = new Map();
  fullNames.forEach((raw) => {
    const name = normalizeName(raw);
    nameParts(name).forEach((part) => {
      if (!owners.has(part)) owners.set(part, name);
      else if (owners.get(part) !== null && !sameName(owners.get(part), name)) owners.set(part, null);
    });
  });
  return owners;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Stricter boundaries than for whole entities: "Gonzalez" must not match
// inside "Gonzalez-Lopez" or "Gonzalez's" (could be someone else).
function partSpans(text, part) {
  const edge = "[\\p{L}\\p{N}_'’-]";
  const re = new RegExp(`(?<!${edge})${escapeRegex(part)}(?!${edge})`, 'gu');
  return [...text.matchAll(re)].map((m) => ({
    start: m.index, end: m.index + m[0].length, type: 'PERSON', value: m[0], source: 'alias',
  }));
}

// Spans for every lone occurrence of an unambiguous name part, carrying the
// full name in `aliasOf`. Source 'alias' ranks below the model, so if the
// model says a word is something else ("Paris" the city), the model wins.
export function nameAliasSpans(text, owners) {
  return [...owners.entries()]
    .filter(([, name]) => name !== null)
    .flatMap(([part, name]) => partSpans(text, part).map((span) => ({ ...span, aliasOf: name })));
}
