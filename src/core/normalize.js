// A detection copy of the text. Copy-paste from web pages, PDFs and phones
// brings characters that break every rule and the model: Arabic-Indic,
// Persian and full-width digits ("٠٧٧٠"), zero-width spaces inside a word,
// right-to-left marks around a number, non-breaking spaces. Detection runs on
// the copy; `toOriginal` maps each span back so the original characters are
// what gets replaced (and restored, byte for byte).

// Zero-width, bidi controls, soft hyphen, BOM, Arabic letter mark.
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
const ODD_SPACE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/;

const DIGIT_ZEROS = [0x0660, 0x06f0, 0xff10, 0x07c0, 0x0966];

function plainDigit(ch) {
  const code = ch.charCodeAt(0);
  const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
  return zero === undefined ? null : String(code - zero);
}

// Any character the copy would change. Most text has none and is used as is.
const NEEDS_VIEW = /[\u00a0\u00ad\u061c\u0660-\u0669\u06f0-\u06f9\u07c0-\u07c9\u0966-\u096f\u180e\u2000-\u200f\u202a-\u202f\u205f-\u2064\u3000\ufeff\uff10-\uff19]/;

// Returns { text, toOriginal(start, end) => { start, end } }.
export function detectionView(original) {
  if (!NEEDS_VIEW.test(original)) {
    return { text: original, toOriginal: (start, end) => ({ start, end }), changed: false };
  }
  const chars = [];
  const origins = [];
  for (let i = 0; i < original.length; i += 1) {
    const ch = original[i];
    if (INVISIBLE.test(ch)) continue;
    chars.push(ODD_SPACE.test(ch) ? ' ' : plainDigit(ch) ?? ch);
    origins.push(i);
  }
  origins.push(original.length);
  const toOriginal = (start, end) => ({
    start: origins[start],
    // One past the last kept character, so invisible characters inside the
    // span go with it and ones just after it stay in the text.
    end: end > start ? origins[end - 1] + 1 : origins[start],
  });
  return { text: chars.join(''), toOriginal, changed: true };
}
