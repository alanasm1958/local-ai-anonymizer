// Tables inside Office files reach detection as rows of tab-separated cells,
// like a TSV, so column rules (ID and place headers) and the model see whole
// rows. Found live on ChatGPT (2026-11-10): an .xlsx and a .docx with a "CIN"
// column were checked one cell per line, and with a fresh vault every CIN
// was sent as typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';
import { anonymizeFile, rewriteSegments } from '../src/core/files.js';
import { extractSegments } from '../src/core/ooxml.js';
import { sharedStringGrid } from '../src/core/xlsx-grid.js';
import { anonymize } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const { strToU8, strFromU8, zipSync, unzipSync } = fflate;

// No model: only rules can hide the IDs, so the column header must be seen.
function clean(name, parts) {
  let vault = createVault();
  const anonymizeText = async (text) => {
    const result = await anonymize(text, { settings: DEFAULT_SETTINGS, vault, detectEntities: async () => [] });
    vault = result.vault;
    return result;
  };
  const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])) });
  return anonymizeFile({ name, type: '', bytes }, { anonymizeText, zip: fflate });
}

const all = (out) => Object.values(unzipSync(out.bytes)).map((b) => strFromU8(b)).join(' ');

const wCell = (text) => `<w:tc><w:tcPr><w:tcW w:w="2000"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const wRow = (cells) => `<w:tr><w:trPr/>${cells.map(wCell).join('')}</w:tr>`;
const WORD_TABLE = `<w:p><w:r><w:t>Applicants</w:t></w:r></w:p><w:tbl><w:tblPr/>${
  [['name', 'CIN', 'city'], ['Salma Bennani', 'BK123456', 'Rabat'], ['Omar Idrissi', 'AB654321', 'Fes']].map(wRow).join('')
}</w:tbl><w:p><w:r><w:t>End</w:t></w:r></w:p>`;

test('Word table cells are read as tab-separated rows', () => {
  const { text } = extractSegments(WORD_TABLE, 'w:t', ['w:p'], { cell: 'w:tc', row: 'w:tr' });
  assert.equal(text, 'Applicants\nname\tCIN\tcity\nSalma Bennani\tBK123456\tRabat\nOmar Idrissi\tAB654321\tFes\nEnd\n');
});

test('docx: IDs under a CIN column are hidden', async () => {
  const out = await clean('list.docx', { 'word/document.xml': `<w:document><w:body>${WORD_TABLE}</w:body></w:document>` });
  const text = all(out);
  assert.ok(!text.includes('BK123456') && !text.includes('AB654321'), text);
  assert.match(text, /\[ID_NUMBER_1\][\s\S]*\[ID_NUMBER_2\]/);
});

test('pptx: IDs in a slide table are hidden', async () => {
  const aCell = (t) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr></a:tc>`;
  const aRow = (cells) => `<a:tr h="370840">${cells.map(aCell).join('')}</a:tr>`;
  const slide = `<p:sld><a:tbl>${[['name', 'passport'], ['Salma', 'N1234567']].map(aRow).join('')}</a:tbl></p:sld>`;
  const out = await clean('deck.pptx', { 'ppt/slides/slide1.xml': slide });
  assert.ok(!all(out).includes('N1234567'));
});

const SHARED = '<sst><si><t>name</t></si><si><t>CIN</t></si><si><t>Salma Bennani</t></si><si><r><t>BK12</t></r><r><rPr><b/></rPr><t>3456</t></r></si><si><t>Omar Idrissi</t></si><si><t>AB654321</t></si><si><t>unused note</t></si></sst>';
const SHEET = '<worksheet><sheetData>'
  + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>'
  + '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c><c r="D3"><v>12</v></c></row>'
  + '</sheetData></worksheet>';

test('shared strings are laid out in sheet order, rows padded to the widest row', () => {
  const { text, segments } = sharedStringGrid(SHARED, [SHEET]);
  assert.equal(text, 'name\tCIN\t\t\nSalma Bennani\tBK123456\t\t\nOmar Idrissi\tAB654321\t\t12\n\nunused note');
  assert.deepEqual(segments.map((s) => text.slice(s.start, s.end)), ['name', 'CIN', 'Salma Bennani', 'BK12', '3456', 'Omar Idrissi', 'AB654321', 'unused note']);
});

test('xlsx with shared strings: IDs under a CIN column are hidden', async () => {
  const out = await clean('list.xlsx', { 'xl/sharedStrings.xml': SHARED, 'xl/worksheets/sheet1.xml': SHEET });
  const text = all(out);
  assert.ok(!text.includes('AB654321') && !/BK12|3456/.test(text), text);
  assert.ok(text.includes('unused note') && text.includes('<b/>'), 'other strings and formatting are kept');
});

test('xlsx with inline strings: IDs under a CIN column are hidden', async () => {
  const cell = (r, t) => `<c r="${r}" t="inlineStr"><is><t>${t}</t></is></c>`;
  const sheet = `<worksheet><sheetData><row r="1">${cell('A1', 'name')}${cell('B1', 'CIN')}</row><row r="2">${cell('A2', 'Salma')}${cell('B2', 'BK123456')}</row></sheetData></worksheet>`;
  const out = await clean('inline.xlsx', { 'xl/worksheets/sheet1.xml': sheet });
  assert.ok(!all(out).includes('BK123456'));
});

test('rewriteSegments works when segments are not in text order', () => {
  const text = 'Bob\tAnn';
  const segments = [{ start: 4, end: 7 }, { start: 0, end: 3 }];
  assert.deepEqual(rewriteSegments(text, segments, [{ start: 0, end: 3, text: '[A]' }, { start: 4, end: 7, text: '[B]' }]), ['[B]', '[A]']);
});
