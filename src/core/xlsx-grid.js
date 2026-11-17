// Excel keeps each distinct text once in xl/sharedStrings.xml, in no table
// order; the sheets point at it by index. Read string by string, a column
// header ("CIN") and its values lose their link (found live: every CIN in
// an .xlsx was sent as typed). This lays the shared strings out as the
// sheets show them, rows of tab-separated cells, so detection reads a TSV.
//
// Each shared string carries its segments (the <t> elements to rewrite) at
// its first use; later uses are plain text with no segment, so a value is
// written once. Strings no sheet uses follow, one per line. Pure, no DOM.

import { extractSegments } from './ooxml.js';

const SI = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/gd;
const ROW = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

// [{ text, segments }] per shared string, xml offsets in the whole part.
function sharedStrings(sstXml) {
  return [...sstXml.matchAll(SI)].map((m) => {
    if (m[1] === undefined) return { text: '', segments: [] };
    const base = m.indices[1][0];
    const { text, segments } = extractSegments(m[1], 't', []);
    return {
      text,
      segments: segments.map((s) => ({
        ...s, openStart: s.openStart + base, xmlStart: s.xmlStart + base, xmlEnd: s.xmlEnd + base,
      })),
    };
  });
}

const columnIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// One cell: { col, shared } for a shared string, else { col, text }.
function readCell(attrs, body = '', fallbackCol) {
  const ref = /\br="([A-Z]{1,3})\d+"/.exec(attrs);
  const col = ref ? columnIndex(ref[1]) : fallbackCol;
  const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
  const value = /<v>([^<]*)<\/v>/.exec(body)?.[1];
  if (type === 's' && value !== undefined) return { col, shared: Number(value) };
  if (type === 'inlineStr') return { col, text: [...body.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((t) => unescape(t[1])).join('') };
  return { col, text: value === undefined ? '' : unescape(value) };
}

function sheetRows(sheetXml) {
  return [...sheetXml.matchAll(ROW)].map((row) => {
    let next = 0;
    return [...(row[1] ?? '').matchAll(CELL)].map((c) => {
      const cell = readCell(c[1], c[2], next);
      next = cell.col + 1;
      return cell;
    });
  });
}

// { text, segments }: segments sorted by position in the XML (for splicing);
// their text positions follow the sheet layout.
export function sharedStringGrid(sstXml, sheetXmls) {
  const strings = sharedStrings(sstXml);
  const placed = new Set();
  const segments = [];
  let text = '';
  const write = (index) => {
    const entry = strings[index];
    if (!entry) return;
    if (!placed.has(index)) {
      placed.add(index);
      segments.push(...entry.segments.map((s) => ({ ...s, start: s.start + text.length, end: s.end + text.length })));
    }
    text += entry.text;
  };
  const sheets = sheetXmls.map(sheetRows).filter((rows) => rows.length);
  sheets.forEach((rows, s) => {
    if (s > 0) text += '\n\n';
    const width = Math.max(...rows.map((cells) => (cells.length ? cells.at(-1).col + 1 : 0)));
    rows.forEach((cells, r) => {
      if (r > 0) text += '\n';
      const byCol = new Map(cells.map((c) => [c.col, c]));
      for (let col = 0; col < width; col += 1) {
        if (col > 0) text += '\t';
        const cell = byCol.get(col);
        if (cell?.shared !== undefined) write(cell.shared);
        else if (cell) text += cell.text;
      }
    });
  });
  const unused = strings.map((_, i) => i).filter((i) => !placed.has(i));
  unused.forEach((i, k) => {
    text += k === 0 ? (text ? '\n\n' : '') : '\n';
    write(i);
  });
  return { text, segments: segments.sort((a, b) => a.xmlStart - b.xmlStart) };
}
