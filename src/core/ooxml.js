// Text engine for Office Open XML files (docx, xlsx, pptx). These are zip
// archives of XML parts. Visible text lives in small elements (w:t, a:t, t)
// that Word and friends split at every formatting change, so one name can
// span several of them. We read a part's text in document order as one
// string, let the caller decide what to replace (with offsets into that
// string), then write each element's share of the new text back in place.
// Some text lives in attribute values instead (pivot caches, link targets);
// those are read and written the same way. Everything else in the XML is
// left untouched. Plain regex scanning, no DOMParser, so it runs in the
// service worker; every quantifier over attributes is bounded.

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const MAX_CODE_POINT = 0x10ffff;

const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z]{2,8});/gi, (m, code) => {
  if (code[0] !== '#') return ENTITY[code.toLowerCase()] ?? m;
  const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return n >= 0 && n <= MAX_CODE_POINT ? String.fromCodePoint(n) : m;
});

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeXml(s).replace(/"/g, '&quot;');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- element text ----------

// Paragraph ends become "\n" and tabs "\t" in the extracted text, so
// detection sees real sentence boundaries; those characters belong to no element.
function scanner(textTag, breakTags) {
  const t = escapeRe(textTag);
  const breaks = breakTags.map(escapeRe).join('|');
  return new RegExp(`(<${t}(?:\\s[^<>]{0,1000})?>)([^<]*)(</${t}>)|</(?:${breaks})>|<(?:w:tab|a:tab)\\s{0,10}/>`, 'g');
}

export function extractSegments(xml, textTag, breakTags) {
  const segments = [];
  let text = '';
  for (const m of xml.matchAll(scanner(textTag, breakTags))) {
    if (m[1] === undefined) {
      text += m[0].includes('tab') ? '\t' : '\n';
      continue;
    }
    const value = unescapeXml(m[2]);
    const contentStart = m.index + m[1].length;
    segments.push({
      start: text.length,
      end: text.length + value.length,
      openStart: m.index,
      openTag: m[1],
      xmlStart: contentStart,
      xmlEnd: contentStart + m[2].length,
    });
    text += value;
  }
  return { text, segments };
}

export const extractOoxmlText = (xml, textTag, breakTags) => extractSegments(xml, textTag, breakTags).text;

// ---------- attribute values ----------

// `pattern` must capture the attribute value in group 1 and use the d flag.
// Values are joined with "\n" so each is detected on its own.
export function extractAttributeSegments(xml, pattern) {
  const segments = [];
  let text = '';
  for (const m of xml.matchAll(pattern)) {
    const [xmlStart, xmlEnd] = m.indices[1];
    const value = unescapeXml(m[1]);
    if (text) text += '\n';
    segments.push({ start: text.length, end: text.length + value.length, xmlStart, xmlEnd });
    text += value;
  }
  return { text, segments };
}

// ---------- rewriting ----------

// New text for each segment. Each span (a value and its replacement) is
// written into the first segment it overlaps; its characters in later
// segments are dropped. Spans must not overlap. One pass over both sorted
// lists, so tens of thousands of replacements stay fast.
export function rewriteSegments(text, segments, spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const placed = new Uint8Array(sorted.length);
  let first = 0;
  return segments.map((seg) => {
    while (first < sorted.length && sorted[first].end <= seg.start) first += 1;
    let out = '';
    let cursor = seg.start;
    for (let k = first; k < sorted.length && sorted[k].start < seg.end; k += 1) {
      const span = sorted[k];
      out += text.slice(cursor, Math.max(span.start, seg.start));
      if (!placed[k]) {
        out += span.text;
        placed[k] = 1;
      }
      cursor = Math.max(cursor, Math.min(span.end, seg.end));
    }
    return out + text.slice(cursor, seg.end);
  });
}

// Word and Excel collapse leading/trailing spaces unless told to keep them.
const PRESERVE = new Set(['w:t', 'w:delText', 'w:instrText', 't']);

function withPreserve(openTag, tag) {
  if (!PRESERVE.has(tag) || /xml:space=/.test(openTag)) return openTag;
  return openTag.replace(/>$/, ' xml:space="preserve">');
}

// Writes new contents back; untouched segments keep their exact bytes.
export function spliceSegments(xml, { text, segments }, contents, tag) {
  let out = '';
  let cursor = 0;
  segments.forEach((seg, i) => {
    if (contents[i] === text.slice(seg.start, seg.end)) return;
    if (tag) {
      out += xml.slice(cursor, seg.openStart) + withPreserve(seg.openTag, tag) + escapeXml(contents[i]);
    } else {
      out += xml.slice(cursor, seg.xmlStart) + escapeAttr(contents[i]);
    }
    cursor = seg.xmlEnd;
  });
  return out + xml.slice(cursor);
}

// ---------- which parts hold text ----------

const textRule = (path, tag, breaks) => ({ path, tag, breaks });
const attrRule = (path, pattern) => ({ path, pattern });

const WORD_TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|glossary\/document)\.xml$/;
const EXTERNAL_TARGET = /<Relationship\b(?=[^<>]{0,2000}\bTargetMode="External")[^<>]{0,2000}?\sTarget="([^"]*)"/gd;
const RELS = /(^|\/)_rels\/[^/]+\.rels$/;
const APP_TITLES = textRule(/^docProps\/app\.xml$/, 'vt:lpstr', ['vt:lpstr']);

// Rules per format; every rule whose path matches is applied to that part.
export const OOXML_RULES = Object.freeze({
  docx: [
    textRule(WORD_TEXT_PARTS, 'w:t', ['w:p']),
    textRule(WORD_TEXT_PARTS, 'w:delText', ['w:p']), // text kept by tracked deletions
    textRule(WORD_TEXT_PARTS, 'w:instrText', ['w:p']), // field codes, e.g. HYPERLINK "mailto:..."
    attrRule(WORD_TEXT_PARTS, /<w:fldSimple\b[^<>]{0,1000}?\sw:instr="([^"]*)"/gd),
    textRule(/^word\/diagrams\/data\d*\.xml$/, 'a:t', ['a:p']),
    attrRule(RELS, EXTERNAL_TARGET),
    APP_TITLES,
  ],
  pptx: [
    textRule(/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/, 'a:t', ['a:p']),
    textRule(/^ppt\/diagrams\/data\d*\.xml$/, 'a:t', ['a:p']),
    textRule(/^ppt\/comments\/comment\d+\.xml$/, 'p:text', ['p:cm']),
    textRule(/^ppt\/comments\/modernComment[^/]*\.xml$/, 'a:t', ['a:p']),
    attrRule(RELS, EXTERNAL_TARGET),
    APP_TITLES,
  ],
  xlsx: [
    textRule(/^xl\/sharedStrings\.xml$/, 't', ['si']),
    textRule(/^xl\/worksheets\/sheet\d+\.xml$/, 't', ['is']),
    textRule(/^xl\/comments\d*\.xml$/, 't', ['comment']),
    textRule(/^xl\/threadedComments\/[^/]+\.xml$/, 'text', ['threadedComment']),
    // Pivot caches keep their own copy of the source data.
    attrRule(/^xl\/pivotCache\/pivotCache(Definition|Records)\d+\.xml$/, /<s\s{1,10}v="([^"]*)"/gd),
    attrRule(RELS, EXTERNAL_TARGET),
  ],
});

export const rulesFor = (kind, path) => OOXML_RULES[kind].filter((rule) => rule.path.test(path));

// ---------- metadata ----------

// "C:\Users\Maria Gonzalez\..." and "/Users/maria/..." become ".../user/...".
const scrubUserPaths = (xml) =>
  xml.replace(/((?:\\|\/|%5C|%2F)(?:Users|home|Documents and Settings)(?:\\|\/|%5C|%2F))[^\\/"%<>]{1,200}/gi, '$1user');

const replaceAttr = (names, value) => (xml) =>
  names.reduce((acc, name) => acc.replace(new RegExp(`(\\s${escapeRe(name)}=")[^"]*(")`, 'g'), `$1${value}$2`), xml);

// Who wrote or edited the file: cleared or replaced with "Author".
const METADATA_RULES = Object.freeze([
  [/^docProps\/core\.xml$/, (xml) => xml.replace(/(<(dc:creator|cp:lastModifiedBy|dc:title|dc:subject|dc:description|cp:keywords)(?:\s[^<>]{0,500})?>)[^<]*(<\/\2>)/g, '$1$3')],
  [/^docProps\/app\.xml$/, (xml) => xml.replace(/(<(Company|Manager)>)[^<]*(<\/\2>)/g, '$1$3')],
  [/^docProps\/custom\.xml$/, (xml) => xml.replace(/(<(vt:lpwstr|vt:lpstr|vt:bstr)>)[^<]*(<\/\2>)/g, '$1$3')],
  [/^word\/.+\.xml$/, replaceAttr(['w:author', 'w15:author'], 'Author')],
  [/^word\/.+\.xml$/, replaceAttr(['w:initials'], 'A')],
  [/^word\/.+\.xml$/, replaceAttr(['w15:userId'], 'user')],
  [/^xl\/comments\d*\.xml$/, (xml) => xml.replace(/(<author>)[^<]*(<\/author>)/g, '$1Author$2')],
  [/^xl\/persons\/.+\.xml$/, replaceAttr(['displayName'], 'Author')],
  [/^xl\/persons\/.+\.xml$/, replaceAttr(['userId'], 'user')],
  [/^xl\/workbook\.xml$/, scrubUserPaths],
  [/^ppt\/(commentAuthors|authors)\.xml$/, replaceAttr(['name'], 'Author')],
  [/^ppt\/(commentAuthors|authors)\.xml$/, replaceAttr(['initials'], 'A')],
  [/^ppt\/(commentAuthors|authors)\.xml$/, replaceAttr(['userId'], 'user')],
  [RELS, scrubUserPaths],
]);

export function clearMetadata(path, xml) {
  return METADATA_RULES.reduce((acc, [pattern, rule]) => (pattern.test(path) ? rule(acc) : acc), xml);
}

// The preview image of the first page can show names: replaced with a blank one.
const BLANK_IMAGES = Object.freeze({
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  jpeg: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
});

export function blankThumbnail(path) {
  const match = /^docProps\/thumbnail\.(png|jpe?g)$/i.exec(path);
  if (!match) return null;
  return BLANK_IMAGES[match[1].toLowerCase() === 'png' ? 'png' : 'jpeg'];
}

// ---------- what isn't checked ----------

export function uncheckedNotes(paths, kind) {
  const count = (re) => paths.filter((p) => re.test(p)).length;
  const notes = [];
  const images = count(/^(word|xl|ppt)\/media\//);
  if (images) notes.push(`${images} image${images === 1 ? '' : 's'} inside the file ${images === 1 ? 'was' : 'were'} not checked.`);
  if (count(/^docProps\/thumbnail\.(?!png$|jpe?g$)/i)) notes.push('The preview thumbnail was not checked.');
  if (count(/^(word|xl|ppt)\/charts\//)) notes.push('Charts were not checked.');
  if (count(/^(word|xl|ppt)\/embeddings\//)) notes.push('Embedded files were not checked.');
  if (count(/^customXml\//)) notes.push('Custom XML data was not checked.');
  if (count(/^xl\/tables\//)) notes.push('Table column names were not checked.');
  if (kind === 'xlsx') notes.push('Sheet names and formulas were not checked.');
  return notes;
}

// Excel cells holding plain numbers (not text) are outside the text engine.
export const hasNumericCells = (sheetXml) =>
  /<c(?![^<>]{0,500}\bt="(?:s|inlineStr|str|b|e)")[^<>]{0,500}>\s{0,50}(?:<f[^<>]{0,500}>[^<]*<\/f>\s{0,50})?<v>/.test(sheetXml);
