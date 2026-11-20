// Completing person names the model only half found. All checks run on the
// text the model read (truecased), where rare words already have a capital.
//
// - MISC: the model has a fourth label for nationalities, events and
//   products, and puts unfamiliar names there ("Hiba Zaqout" came back MISC
//   0.47). A MISC group of two or more capitalized words its vocabulary does
//   not know is read as a person.
// - Neighbours: "[PERSON_1] Qasem", "Fatima [PERSON_1]", "Odeh, [PERSON_1]".
//   A capitalized word right next to a person (one space, or a comma for
//   "Surname, First", same line) joins it when it reads as a proper noun: the
//   vocabulary does not know it in lowercase ("Fatima" yes, "Contact" no), or
//   the model gave it an entity label. Months and days never join.
// - Particles: "el-Sayed", "Abu Hammad", "Ben Salah", "Abdel Aziz" join the
//   name together with the word after them.

// Particles that are also everyday English words (at, as, ad, ed) join only with
// a hyphen ("at-Tahir"): "Rashid at Gulf Petro" is a person, then a company.
const PARTICLE = /^[ \t](?:(?:al|el|abu|abou|ben|bin|ibn|bint|abd|abdel|abdul|abi|ould|ait|bou|ul|ash|az)(?:[ -]|(?=-))|(?:ed|ad|as|at)-)/i;
const NAME_WORD = /^-?[\p{L}][\p{L}'’]*(?:-[\p{L}][\p{L}'’]*)?/u;
const CAPITAL_WORD = /^(,?)[ \t](\p{Lu}[\p{L}'’]*(?:-[\p{L}][\p{L}'’]*)?)(?![\p{L}\p{N}@])/u;
const CAPITAL_WORD_BEFORE = /(?<![\p{L}\p{N}@.])(\p{Lu}[\p{L}'’]*(?:-[\p{L}][\p{L}'’]*)?)(,?)[ \t]$/u;
// "Surname, First" only where the pair stands alone: the first name ends
// the phrase ("Odeh, Tareq" in a cell, at the end of a line, before a quote
// or a full stop). "Thanks Sarah, Inshallah we meet" must not join.
const PHRASE_END = /^\s*(?:$|[\n|"'”’)\].;:!?]|,\s*$)/;
// "I", "I'll", "I'm": a pronoun, never a name part.
const PRONOUN = /^I(?:['’]\p{Ll}+)?$/u;
// "Saeed Al" + "-Ketbi": a particle the model kept, cut from its surname.
const HYPHEN_TAIL = /(?:^|[\s-])(?:al|el|abu|ben|bin|abd|abi|ibn|ul|ed|ad|as|ash|at|az)-?$/i;
const HYPHEN_WORD = /^-?[\p{L}][\p{L}'’]*/u;
const CALENDAR = new Set(['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const MAX_STEPS = 3;
const NAME_PARTICLES = new Set(['al', 'el', 'abu', 'abou', 'ben', 'bin', 'ibn', 'bint', 'abd', 'abdel', 'abdul', 'abi', 'ould', 'ait', 'bou']);

export const isCapitalized = (word) => /^\p{Lu}/u.test(word);

// Known = in the model's vocabulary as typed or in lowercase.
export const knownWordCheck = (isKnownWord) => (word) => isKnownWord(word) || isKnownWord(word.toLowerCase());

function particleAfter(text, end) {
  const p = PARTICLE.exec(text.slice(end));
  if (!p) return null;
  const word = NAME_WORD.exec(text.slice(end + p[0].length));
  return word ? end + p[0].length + word[0].length : null;
}

// `canJoin(word, start, end)` decides whether a neighbouring word is part of the name.
// Each returns the new edge, or null. A proper noun across a comma that does
// not end the phrase ("Thanks Layla, Zaid will join") is not merged but is
// still a person of its own: it goes to `siblings`.
function wordAfter(text, end, canJoin, siblings) {
  const m = CAPITAL_WORD.exec(text.slice(end));
  if (!m) return null;
  const [, comma, word] = m;
  const start = end + m[0].length - word.length;
  if (!canJoin(word, start, start + word.length, Boolean(comma))) return null;
  if (comma && !PHRASE_END.test(text.slice(start + word.length))) {
    siblings.push({ start, end: start + word.length });
    return null;
  }
  return start + word.length;
}

function wordBefore(text, start, end, canJoin, siblings) {
  const m = CAPITAL_WORD_BEFORE.exec(text.slice(Math.max(0, start - 40), start));
  if (!m) return null;
  const [, word, comma] = m;
  const from = start - m[0].length;
  if (!canJoin(word, from, from + word.length, Boolean(comma))) return null;
  if (comma && !PHRASE_END.test(text.slice(end))) {
    siblings.push({ start: from, end: from + word.length });
    return null;
  }
  return from;
}

function hyphenTail(text, start, end) {
  const inside = text.slice(start, end);
  if (!HYPHEN_TAIL.test(inside)) return null;
  const m = HYPHEN_WORD.exec(text.slice(end));
  // "Al" + "-Ketbi", or "al-" + "sabah"; a bare "Al" + " word" is a particle step.
  return m && (inside.endsWith('-') || m[0].startsWith('-')) ? end + m[0].length : null;
}

// Returns the grown span followed by any separate people found next to it.
function grow(text, span, canJoin) {
  let { start, end } = span;
  const siblings = [];
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const next = hyphenTail(text, start, end) ?? particleAfter(text, end) ?? wordAfter(text, end, canJoin, siblings);
    if (next === null) break;
    end = next;
  }
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const prev = wordBefore(text, start, end, canJoin, siblings);
    if (prev === null) break;
    start = prev;
  }
  return [{ ...span, start, end }, ...siblings.map((s) => ({ ...span, ...s }))];
}

// A place or company tagged on a first name with an "Al-"/"El-" surname
// after it or cut inside it ("[LOCATION] Al-Khalifa", "[ORG]-Khalifa") is a person.
const PARTICLE_SURNAME = /^[ \t](?:al|el)-\p{L}/iu;
const STARTS_WITH_PARTICLE = /^(?:al|el)-\p{L}/iu;
const PROPER_BEFORE = /(\p{Lu}\p{Ll}+)[ \t]$/u;
// "Noura [ORGANIZATION: Al-Sabah]": a first name in front of an "Al-" family name.
const firstNameBefore = (text, s, isProperNoun) => STARTS_WITH_PARTICLE.test(text.slice(s.start, s.end))
  && isProperNoun(PROPER_BEFORE.exec(text.slice(Math.max(0, s.start - 30), s.start))?.[1] ?? '');
const isParticleSurname = (text, s, isProperNoun) => PARTICLE_SURNAME.test(text.slice(s.end))
  || hyphenTail(text, s.start, s.end) !== null || firstNameBefore(text, s, isProperNoun);

// spans: [{ kind: 'PER'|..., start, end }] in `text`.
// `labelled(start, end)`: whether the model gave those characters an entity label.
// `isNoise(word)`: greeting, command and stoplist words that never join.
// `isProperNoun(word)`: unknown to the vocabulary in lowercase.
// `strong(span)`: a confident place or company, which a name must not swallow.
export function completePersons(text, spans, { isProperNoun, labelled, isNoise, strong }) {
  const joinable = (word, start, end) => !isNoise(word) && !CALENDAR.has(word.toLowerCase()) && !PRONOUN.test(word)
    && (isProperNoun(word) || labelled(start, end));
  // Across a comma, never into another entity the model found ("Sarah, Ahmed").
  const inOtherGroup = (s, e, self) => typed.some((o) => o !== self && s < o.end && o.start < e);
  const typed = spans.map((s) => (s.kind !== 'PER' && s.kind !== 'MISC' && isParticleSurname(text, s, isProperNoun) ? { ...s, kind: 'PER' } : s));
  const blocks = (s, e, self) => typed.some((o) => o !== self && o.kind !== 'PER' && strong(o) && s < o.end && o.start < e);
  const grown = typed.flatMap((span) => (span.kind === 'PER'
    ? grow(text, span, (word, s, e, comma) => joinable(word, s, e) && !blocks(s, e, span) && !(comma && inOtherGroup(s, e, span)))
    : [span]));
  // Groups a grown name now covers (an unsure "Zaqout" tagged MISC) go.
  const people = grown.filter((g) => g.kind === 'PER');
  return grown.filter((g) => g.kind === 'PER' || !people.some((p) => p.start <= g.start && g.end <= p.end));
}

// "[LOCATION: Nile] valley trading co.": a name with a company word up to
// three words after it is one organization, in any casing.
const COMPANY_TAIL = /^((?:[ \t]\p{L}[\p{L}&'’-]*){0,2}[ \t](?:co|company|corp|holding|holdings|group|trading|traders|ltd|limited|llc|sarl|sal|plc|inc|textiles|logistics|consulting|engineering|pharma|media|capital|construction|bank|university|college|institute|foundation|association))(?![\p{L}\p{N}])/iu;

// "our partner carthage textiles": up to three words ending in a company
// word, where at least one word is a proper noun, is an organization even
// when the model tagged nothing. Starts at the first proper noun.
const COMPANY_PHRASE = /(?<![\p{L}\p{N}])((?:\p{L}[\p{L}&'’-]*[ \t]){1,3})(co|company|corp|holding|holdings|group|trading|traders|ltd|limited|llc|sarl|sal|plc|inc|textiles|logistics|consulting|engineering|pharma|media|capital|construction)(?![\p{L}\p{N}])/giu;

const overlaps = (spans, s, e) => spans.some((o) => s < o.end && o.start < e);

function companyPhrases(text, spans, isProperNoun, isNoise) {
  const found = [];
  for (const m of text.matchAll(COMPANY_PHRASE)) {
    const words = m[1].trim().split(/[ \t]+/);
    const first = words.findIndex((w) => isProperNoun(w) && !isNoise(w));
    if (first === -1) continue;
    const start = m.index + m[1].indexOf(words[first]);
    const end = m.index + m[0].length;
    if (!overlaps(spans, start, end)) found.push({ kind: 'ORG', start, end, scores: [1] });
  }
  return found;
}

export function completeOrganizations(text, spans, { isProperNoun, isNoise } = {}) {
  const tailed = spans.map((s) => {
    if (!['ORG', 'LOC'].includes(s.kind)) return s;
    const tail = COMPANY_TAIL.exec(text.slice(s.end));
    // The company word is evidence of its own, like "Ltd" in orgs.js.
    return tail ? { ...s, kind: 'ORG', end: s.end + tail[1].length, scores: [1] } : s;
  });
  return isProperNoun ? [...tailed, ...companyPhrases(text, tailed, isProperNoun, isNoise)].sort((a, b) => a.start - b.start) : tailed;
}

// "| Contact | Karim |", "\"contact\": \"Shilan\"", "assigned:Aras", "Contact Mona
// today": a proper noun right after a label that names a person is a
// person, however unsure the model is (it scored these 0.3 to 0.5). Up to
// three proper nouns; stops at the first everyday word.
const FIELD = /(?<![\p{L}\p{N}])(?:full name|first name|last name|surname|name|contact|owner|student|employee|applicant|participant|trainee|attendee|candidate|assigned to|assigned|assignee|instructor|teacher|parent|guardian)(?![\p{L}\p{N}])["'”’]?[\s"'“”‘’:|,=]{1,6}/giu;
const FIELD_WORD = /^\p{Lu}[\p{L}'’-]*/u;

export function fieldNames(text, spans, { isProperNoun, isNoise, strong }) {
  const found = [];
  const confirmed = new Set();
  for (const m of text.matchAll(FIELD)) {
    const start = m.index + m[0].length;
    const end = fieldNameEnd(text, start, { isProperNoun, isNoise });
    if (end === start) continue;
    const under = spans.filter((o) => start < o.end && o.start < end);
    // A person the model already found there is confirmed as it is (it may
    // be longer: "Sonia Ben Salah"); a confident place or company keeps its
    // reading; otherwise the field name replaces whatever weak tag was there.
    const people = under.filter((o) => o.kind === 'PER');
    if (people.length) people.forEach((o) => confirmed.add(o));
    else if (!under.some(strong)) found.push({ kind: 'PER', start, end, scores: [1] });
  }
  const kept = spans
    .filter((o) => !found.some((f) => f.start < o.end && o.start < f.end))
    .map((o) => (confirmed.has(o) ? { ...o, scores: [1] } : o));
  return [...kept, ...found].sort((a, b) => a.start - b.start);
}

// Up to three proper nouns, with particles ("Ben", "El-") between them.
function fieldNameEnd(text, start, { isProperNoun, isNoise }) {
  let end = start;
  for (let i = 0; i < 5; i += 1) {
    const gap = i === 0 ? '' : /^[ \t]/.exec(text.slice(end))?.[0];
    if (gap === undefined) break;
    const word = FIELD_WORD.exec(text.slice(end + gap.length))?.[0];
    if (!word) break;
    const particle = NAME_PARTICLES.has(word.toLowerCase().replace(/-$/, ''));
    if (!particle && (!isProperNoun(word) || isNoise(word) || CALENDAR.has(word.toLowerCase()))) break;
    end += gap.length + word.length;
  }
  // A particle on its own at the end is not part of the name.
  const tail = text.slice(start, end).split(/[ \t]+/).at(-1) ?? '';
  return NAME_PARTICLES.has(tail.toLowerCase()) ? end - tail.length - 1 : end;
}

// A MISC group of two or more unknown capitalized words is a person. One
// word alone is too often a product, currency or plural ("EGP", "Brochures").
// Stoplisted words ("Excel Formulas") rule a group out.
export function miscAsPerson(text, isKnown, isNoise = () => false) {
  return (g) => {
    if (g.kind !== 'MISC') return g;
    const words = text.slice(g.start, g.end).split(/[\s-]+/).filter(Boolean);
    const rare = (w) => isCapitalized(w) && /\p{Ll}{2}/u.test(w) && !isKnown(w);
    // Initials ("A.") and particles ("El") may sit in a name, not make one.
    const filler = (w) => /^\p{Lu}\.$/u.test(w) || NAME_PARTICLES.has(w.toLowerCase());
    const nameLike = words.length >= 2 && words.every((w) => (rare(w) || filler(w)) && !isNoise(w)) && words.some(rare);
    return nameLike ? { ...g, kind: 'PER' } : g;
  };
}
