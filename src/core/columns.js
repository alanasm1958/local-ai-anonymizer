// Values in a table column whose header names the data: "cin", "passport",
// "phone"... A value under such a header has no keyword next to it, so the
// keyword rules miss it (found live: "AB654321" in the second row of a CSV
// with a "cin" column was sent as typed). Works for CSV, TSV and markdown
// tables. Only cells with a digit count, so "n/a" or a blank stay.

const ID_HEADER = /^(?:cin|cnie|nid|passport(?: ?(?:no\.?|number|#))?|national ?id|national ?number|civil ?id|emirates ?id|iqama|id ?(?:no\.?|number|#)?|student ?id|employee ?(?:id|no\.?|number)|staff ?id|case ?(?:no\.?|number|#)|account ?(?:no\.?|number)|الرقم القومي|رقم الهوية|الرقم المدني|رقم الإقامة|جواز السفر)$/i;
const PHONE_HEADER = /^(?:phone|mobile|cell|tel|telephone|whats ?app|contact ?number|phone ?number|mobile ?number|هاتف|الهاتف|جوال|الجوال|موبايل|رقم الهاتف)$/i;
// Place columns: the model reads a lone city in a row as a person ("Rabat"
// B-PER 0.89, found live), and in an Office table it saw "Rabat" as a place
// at 0.50, under the bar. A cell under such a header is a place.
const PLACE_HEADER = /^(?:city|town|country|location|place|region|province|governorate|nationality|birth ?place|place of birth|المدينة|البلد|الدولة|المحافظة|المنطقة|الجنسية|مكان الولادة|مكان الميلاد)$/i;
const CELL_VALUE = /^[A-Za-z0-9+()][A-Za-z0-9+()./ -]{2,30}$/;

const SEPARATORS = [
  { split: /\t/, test: (line) => line.includes('\t') },
  { split: /\|/, test: (line) => /^\s*\|.*\|\s*$/.test(line) },
  { split: /,/, test: (line) => line.includes(',') },
];

// [{ text, start }] cells of one line, offsets in the whole text.
function cells(line, offset, sep) {
  const parts = [];
  let at = 0;
  for (const raw of line.split(sep.split)) {
    const lead = raw.length - raw.trimStart().length;
    parts.push({ text: raw.trim(), start: offset + at + lead });
    at += raw.length + 1;
  }
  return parts;
}

function typeFor(header) {
  if (ID_HEADER.test(header)) return 'ID_NUMBER';
  if (PHONE_HEADER.test(header)) return 'PHONE';
  return null;
}

function lineList(text) {
  let offset = 0;
  return text.split('\n').map((line) => {
    const entry = { line, offset };
    offset += line.length + 1;
    return entry;
  });
}

// Every cell under a header that `typeFor` names: [{ text, start, type }].
function typedCells(text, typeFor) {
  if (!text || !/[\t,|]/.test(text)) return [];
  const found = [];
  let header = null;
  for (const { line, offset } of lineList(text)) {
    const sep = SEPARATORS.find((s) => s.test(line));
    if (!sep || /^\s*\|?\s*:?-{3,}/.test(line)) {
      if (!sep) header = null;
      continue;
    }
    const row = cells(line, offset, sep);
    const types = row.map((c) => typeFor(c.text.replace(/[*_`"']/g, '')));
    if (types.some(Boolean)) {
      header = { sep, types, width: row.length };
      continue;
    }
    if (!header || header.sep !== sep || row.length !== header.width) continue;
    row.forEach((c, i) => {
      if (header.types[i] && c.text) found.push({ ...c, type: header.types[i] });
    });
  }
  return found;
}

// Spans for every cell under a header that names IDs or phones.
export function columnSpans(text, enabledTypes) {
  return typedCells(text, typeFor)
    .filter((c) => enabledTypes[c.type] === true && CELL_VALUE.test(c.text) && /\d/.test(c.text))
    .map((c) => ({ start: c.start, end: c.start + c.text.length, type: c.type, value: c.text, source: 'pattern' }));
}

// Values in a place column that name no place.
const NOT_PLACE = new Set(['n/a', 'na', 'none', 'nil', 'unknown', 'tbd', 'tba', 'remote', 'online', 'virtual', 'other', 'various', 'any', 'all', 'same', 'yes', 'no']);
const PLACE_CELL = /^\p{L}[\p{L}\p{M} .'’-]{1,60}$/u;

// Cell texts under a place header, as typed: letters only, at most four
// words, no filler ("n/a", "Remote").
export function placeCells(text) {
  const placeFor = (header) => (PLACE_HEADER.test(header) ? 'LOCATION' : null);
  return typedCells(text, placeFor)
    .map((c) => c.text)
    .filter((t) => PLACE_CELL.test(t) && t.split(/\s+/).length <= 4 && !NOT_PLACE.has(t.toLowerCase()));
}

// The same, lowercased, for matching what the model found.
export const columnPlaces = (text) => new Set(placeCells(text).map((t) => t.toLowerCase()));
