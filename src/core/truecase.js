// The built-in NER model is cased: typed in lowercase, most names ("omar",
// "sarah johnson") go unseen. Lowercase words the model's own vocabulary does
// not know are rare words, mostly names and places, so they get a capital
// before the model reads the text. Everyday words stay as typed, including
// ones that are also names ("will", "may", "mark"): they are in the vocabulary.
// Only characters whose other case has the same length are touched, so the
// length never changes and every entity offset still points at the original text.

// Plain words in prose only: not part of an identifier, path, address, tag,
// property access or accented word ("user.name", "path/to", "#tag", "café").
const PROSE_WORD = /(?<![\p{L}\p{N}.@/\\#$`=-])(?<![\p{L}\p{N}_]_)\p{Ll}{2,}(?![\p{L}\p{N}@/\\(`=-]|_[\p{L}\p{N}_]|\.[\p{L}\p{N}])/gu;

// Chat shorthand is missing from the vocabulary too, but capitalized it reads
// as a name ("Thx" was tagged PERSON, "Pls" ORGANIZATION).
const SHORTHAND = new Set([
  'thx', 'thnx', 'tks', 'ty', 'pls', 'plz', 'lol', 'lmao', 'btw', 'imo', 'imho', 'idk', 'tbh', 'fyi', 'omg',
  'asap', 'np', 'ok', 'okay', 'pfa', 'eod', 'eta', 'wrt', 'aka', 'etc', 'irl', 'afaik', 'brb', 'ttyl',
  'json', 'yaml', 'yml', 'csv', 'sql', 'xml', 'css', 'regex', 'npm', 'repo', 'api', 'env', 'config', 'async', 'cli', 'sdk',
  // Tests and degrees (Amideast's daily vocabulary): "toefl" is not a name.
  'toefl', 'ielts', 'toeic', 'gre', 'gmat', 'sat', 'ged', 'mba', 'phd', 'msc', 'bsc', 'pte',
  'gonna', 'wanna', 'gotta', 'cuz', 'ur', 'msg', 'pic', 'pics', 'info', 'todo', 'faq', 'tho', 'rn', 'nvm',
]);

// A line typed in capitals ("PLEASE EMAIL LAYLA MANSOUR") reads as noise to
// a cased model: it is lowered first, then rare words get their capital back.
// Only A-Z is lowered, so the length never changes.
const MIN_SHOUTED_WORDS = 3;
// In a row of a table or list ("| OMAR FAROUK | omar@x.example |"), one
// cell in capitals is enough; the lowercase email must not shield it.
// Found live on ChatGPT: "OMAR" was replaced and "FAROUK" sent.
const MIN_SHOUTED_IN_CELL = 2;
const CELL_SEPARATOR = /[|,;:\t]/;
const CELL = /[^|,;:\t]+/g;
// Letters of any script ("BÊRIVAN OMER" is shouted too).
const isShouted = (s, min = MIN_SHOUTED_WORDS) => !/\p{Ll}/u.test(s)
  && (s.match(/(?<!\p{L})\p{Lu}{2,}(?!\p{L})/gu) ?? []).length >= min;
const sameLength = (from, to) => (to.length === from.length ? to : from);
const lowerAZ = (s) => s.replace(/\p{Lu}/gu, (c) => sameLength(c, c.toLowerCase()));

// "gEoRgEs", "nOuRa": case flipping on most letters is noise, not meaning
// (real mixed case like "McDonald", "JavaScript", "iPhone" flips rarely).
const MIN_FLIPS = 2;
const flips = (w) => {
  const letters = w.replace(/-/g, '');
  return [...letters].slice(1).filter((c, i) => /\p{Lu}/u.test(c) !== /\p{Lu}/u.test(letters[i])).length;
};
const flipped = (w) => flips(w) >= MIN_FLIPS && flips(w) >= 0.75 * (w.replace(/-/g, '').length - 1);
const unflip = (text) => text.replace(/\p{L}+(?:-\p{L}+)*/gu, (w) => (flipped(w) ? lowerAZ(w) : w));

// "el-sayed", "al-khatib": a lowercase Arabic name particle and the rare
// word after it both get a capital ("El-Sayed"), so the model sees a name.
const PARTICLE_NAME = /(?<![\p{L}\p{N}])(al|el)-(\p{Ll}{2,})(?![\p{L}\p{N}])/gu;
const deshoutLine = (line) => {
  if (isShouted(line)) return lowerAZ(line);
  if (!CELL_SEPARATOR.test(line)) return line;
  return line.replace(CELL, (cell) => (isShouted(cell, MIN_SHOUTED_IN_CELL) ? lowerAZ(cell) : cell));
};
// Whole text in capitals (a header block), else line by line, cell by cell.
const deshout = (text) => (isShouted(text) ? lowerAZ(text) : text.replace(/[^\n]+/g, deshoutLine));

// "Owner - BÊRIVAN OMER", "please email OMAR FAROUK": two or more capital
// words in a row inside an ordinary line are a name in capitals, unless the
// vocabulary knows every one of them as typed (acronyms: "NASA ESA").
const CAPS_RUN = /(?<!\p{L})\p{Lu}{2,}(?:[ \t]+\p{Lu}{2,})+(?!\p{L})/gu;
const lowerCapsRuns = (text, isKnownWord) => text.replace(/[^\n]+/g, (line) => (!/\p{Ll}/u.test(line) ? line
  : line.replace(CAPS_RUN, (run) => (run.split(/[ \t]+/).every(isKnownWord) ? run : lowerAZ(run)))));

// "t. odeh" reads as "T. Odeh": an initial in front of a name that just got
// its capital. Not after a dot or letter ("i.e. Foo" stays).
const INITIAL = /(?<![\p{L}\p{N}.])\p{Ll}(?=\.[ \t]\p{Lu}\p{Ll})/gu;

export function truecase(text, isKnownWord) {
  const keep = (word) => isKnownWord(word) || SHORTHAND.has(word);
  const capital = (word) => sameLength(word[0], word[0].toUpperCase()) + word.slice(1);
  const cased = lowerCapsRuns(deshout(unflip(text)), isKnownWord)
    .replace(PARTICLE_NAME, (all, particle, name) => (keep(name) ? all : `${capital(particle)}-${capital(name)}`));
  return cased.replace(PROSE_WORD, (word) => (keep(word) ? word : capital(word)))
    .replace(INITIAL, (letter) => capital(letter));
}

// The tokenizer's vocabulary (Map or plain object) as a word lookup.
export function vocabularyLookup(vocab) {
  return vocab instanceof Map ? (word) => vocab.has(word) : (word) => Object.hasOwn(vocab, word);
}
