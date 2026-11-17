import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget } from './helpers/timing.js';
import { readFileSync, readdirSync } from 'node:fs';
import * as fflate from 'fflate';
import {
  classifyFile, anonymizeFile, restoreFile, rewriteSegments, extractOoxmlText, MAX_FILE_BYTES,
} from '../src/core/files.js';
import { anonymize, placeholderSpans } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const { strToU8, strFromU8, zipSync, unzipSync } = fflate;
const KNOWN = [
  { text: 'Maria Gonzalez', type: 'PERSON' },
  { text: 'Northwind Traders', type: 'ORGANIZATION' },
  { text: 'Smith & Sons', type: 'ORGANIZATION' },
];

// Real anonymizer with a fake model that knows a few names; the vault is
// threaded between calls like the service worker does.
function session() {
  let vault = createVault();
  const detectEntities = async (text) => KNOWN.filter((e) => text.includes(e.text));
  return {
    anonymizeText: async (text) => {
      const result = await anonymize(text, { settings: DEFAULT_SETTINGS, vault, detectEntities });
      vault = result.vault;
      return result;
    },
    restoreSpans: (text) => placeholderSpans(text, vault),
  };
}

const file = (name, text, type = '') => ({ name, type, bytes: strToU8(text) });
const run = (s, f) => anonymizeFile(f, { anonymizeText: s.anonymizeText, zip: fflate });

// ---------- classification ----------

test('classifyFile recognises text, office and unsupported files', () => {
  const kind = (name, type = '', size = 10) => classifyFile({ name, type, size }).kind;
  assert.equal(kind('notes.txt'), 'text');
  assert.equal(kind('README.md'), 'text');
  assert.equal(kind('data.csv'), 'text');
  assert.equal(kind('app.py'), 'text');
  assert.equal(kind('.env'), 'text');
  assert.equal(kind('mystery', 'text/plain'), 'text');
  assert.equal(kind('config.json'), 'json');
  assert.equal(kind('report.docx'), 'docx');
  assert.equal(kind('Budget.XLSX'), 'xlsx');
  assert.equal(kind('deck.pptx'), 'pptx');
  assert.equal(kind('scan.pdf'), 'unsupported');
  assert.equal(kind('photo.png', 'image/png'), 'unsupported');
  assert.equal(kind('old.doc'), 'unsupported');
  assert.equal(kind('archive.zip'), 'unsupported');
  assert.equal(kind('big.txt', '', MAX_FILE_BYTES + 1), 'unsupported');
  assert.match(classifyFile({ name: 'scan.pdf', type: '', size: 1 }).reason, /PDF/);
  assert.match(classifyFile({ name: 'photo.png', type: 'image/png', size: 1 }).reason, /image/i);
});

// ---------- text ----------

test('text files are anonymized, and so is a name in the file name', async () => {
  const s = session();
  const out = await run(s, file('Maria_Gonzalez_notes.txt', 'Call Maria Gonzalez at maria@x.io\nThanks'));
  assert.equal(out.status, 'cleaned');
  assert.equal(strFromU8(out.bytes), 'Call [PERSON_1] at [EMAIL_1]\nThanks');
  assert.equal(out.name, '[PERSON_1]_notes.txt');
  assert.equal(out.replacements.length, 3);
});

test('a byte-order mark is kept and non-UTF-8 bytes are refused', async () => {
  const s = session();
  const bom = await run(s, { name: 'a.txt', type: '', bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('maria@x.io')]) });
  assert.deepEqual([...bom.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const binary = await run(s, { name: 'a.txt', type: '', bytes: new Uint8Array([0xff, 0xfe, 0x00, 0xd8]) });
  assert.equal(binary.status, 'unsupported');
});

test('files with nothing sensitive come back unchanged', async () => {
  const out = await run(session(), file('todo.md', '- buy milk\n- call the plumber'));
  assert.equal(out.status, 'unchanged');
  assert.equal(strFromU8(out.bytes), '- buy milk\n- call the plumber');
});

test('CSV keeps its structure', async () => {
  const out = await run(session(), file('people.csv', 'name,email,amount\nMaria Gonzalez,maria@x.io,4200\n'));
  assert.equal(strFromU8(out.bytes), 'name,email,amount\n[PERSON_1],[EMAIL_1],4200\n');
});

test('JSON stays valid: strings are anonymized, numbers and keys are kept', async () => {
  const json = JSON.stringify({ owner: 'Maria Gonzalez', contact: { email: 'maria@x.io', phone: 4155550132 }, tags: ['Northwind Traders', 'vip'] }, null, 2);
  const out = await run(session(), file('record.json', json));
  const parsed = JSON.parse(strFromU8(out.bytes));
  assert.deepEqual(parsed, { owner: '[PERSON_1]', contact: { email: '[EMAIL_1]', phone: 4155550132 }, tags: ['[ORGANIZATION_1]', 'vip'] });
  assert.match(strFromU8(out.bytes), /\n {2}"owner"/, 'indentation kept');
  assert.ok(out.notes.some((n) => /numbers/i.test(n)));
});

test('invalid JSON is handled as plain text', async () => {
  const out = await run(session(), file('broken.json', '{ "owner": "Maria Gonzalez", }'));
  assert.equal(strFromU8(out.bytes), '{ "owner": "[PERSON_1]", }');
});

// ---------- Office documents ----------

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body, extra = {}) => zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
  'docProps/core.xml': strToU8('<cp:coreProperties><dc:creator>Maria Gonzalez</dc:creator><cp:lastModifiedBy>Maria Gonzalez</cp:lastModifiedBy><dc:title>Notes</dc:title></cp:coreProperties>'),
  ...extra,
});

const SPLIT_RUNS = '<w:p><w:r><w:t>Call Ma</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ria Gonz</w:t></w:r>'
  + '<w:r><w:t xml:space="preserve">alez at maria@x.io for Smith &amp; Sons</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p>';

test('docx: a name split across formatting runs is still replaced', async () => {
  const out = await run(session(), { name: 'letter.docx', type: '', bytes: docx(SPLIT_RUNS) });
  assert.equal(out.status, 'cleaned');
  const parts = unzipSync(out.bytes);
  const xml = strFromU8(parts['word/document.xml']);
  assert.equal(extractOoxmlText(xml, 'w:t', ['w:p']), 'Call [PERSON_1] at [EMAIL_1] for [ORGANIZATION_1]\nSecond line\n');
  assert.ok(!xml.includes('Maria') && !xml.includes('ria Gonz') && !xml.includes('Smith'));
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr>/, 'formatting runs are kept');
});

test('docx: author metadata and comment authors are cleared, images are reported', async () => {
  const comments = `<w:comments ${W}><w:comment w:id="0" w:author="Maria Gonzalez" w:initials="MG"><w:p><w:r><w:t>Ask Maria Gonzalez</w:t></w:r></w:p></w:comment></w:comments>`;
  const out = await run(session(), {
    name: 'letter.docx',
    type: '',
    bytes: docx(SPLIT_RUNS, { 'word/comments.xml': strToU8(comments), 'word/media/image1.png': new Uint8Array([1, 2, 3]) }),
  });
  const parts = unzipSync(out.bytes);
  const all = Object.values(parts).map((b) => strFromU8(b)).join(' ');
  assert.ok(!all.includes('Maria'), 'no trace of the name anywhere in the package');
  assert.match(strFromU8(parts['docProps/core.xml']), /<dc:creator><\/dc:creator>/);
  assert.ok(out.notes.some((n) => /1 image/.test(n)), out.notes.join(' | '));
});

test('xlsx: shared strings and inline strings are anonymized; numeric cells are reported', async () => {
  const shared = '<sst><si><t>Maria Gonzalez</t></si><si><r><t>Northwind </t></r><r><rPr><b/></rPr><t>Traders</t></r></si><si><t>vip</t></si></sst>';
  const sheet = '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>maria@x.io</t></is></c><c><v>4155550132</v></c></row></sheetData></worksheet>';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/sharedStrings.xml': strToU8(shared),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
  const out = await run(session(), { name: 'Book.xlsx', type: '', bytes });
  const parts = unzipSync(out.bytes);
  assert.equal(extractOoxmlText(strFromU8(parts['xl/sharedStrings.xml']), 't', ['si']), '[PERSON_1]\n[ORGANIZATION_1]\nvip\n');
  assert.match(strFromU8(parts['xl/worksheets/sheet1.xml']), /<is><t[^>]*>\[EMAIL_1\]<\/t><\/is>/);
  assert.ok(out.notes.some((n) => /stored as numbers/.test(n)));
});

test('pptx: slide text is anonymized', async () => {
  const slide = '<p:sld><p:txBody><a:p><a:r><a:t>Owner: Maria Gonzalez</a:t></a:r></a:p></p:txBody></p:sld>';
  const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/slides/slide1.xml': strToU8(slide) });
  const out = await run(session(), { name: 'deck.pptx', type: '', bytes });
  assert.match(strFromU8(unzipSync(out.bytes)['ppt/slides/slide1.xml']), /<a:t>Owner: \[PERSON_1\]<\/a:t>/);
});

test('a broken Office file is refused, not passed through', async () => {
  const out = await run(session(), { name: 'fake.docx', type: '', bytes: strToU8('not a zip') });
  assert.equal(out.status, 'unsupported');
});

test('unsupported files are reported with a reason and not modified', async () => {
  const out = await run(session(), { name: 'scan.pdf', type: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) });
  assert.equal(out.status, 'unsupported');
  assert.match(out.reason, /PDF/);
});

// ---------- restore ----------

const restore = (s, f) => restoreFile(f, { restoreSpans: s.restoreSpans, zip: fflate });

test('restoring a text file and its name round-trips exactly', async () => {
  const s = session();
  const original = 'Call Maria Gonzalez at maria@x.io';
  const cleaned = await run(s, file('Maria_Gonzalez.txt', original));
  const back = await restore(s, { name: cleaned.name, type: '', bytes: cleaned.bytes });
  assert.equal(back.status, 'restored');
  assert.equal(strFromU8(back.bytes), original);
  assert.equal(back.name, 'Maria_Gonzalez.txt');
});

test('restoring JSON keeps it valid even when values contain quotes', async () => {
  const s = session();
  await s.anonymizeText('Northwind Traders');
  const reply = JSON.stringify({ client: '[ORGANIZATION_1]', note: 'He said "hi" to [ORGANIZATION_1]' });
  const back = await restore(s, file('reply.json', reply));
  assert.deepEqual(JSON.parse(strFromU8(back.bytes)), { client: 'Northwind Traders', note: 'He said "hi" to Northwind Traders' });
});

test('restoring a docx escapes XML characters in real values', async () => {
  const s = session();
  const cleaned = await run(s, { name: 'letter.docx', type: '', bytes: docx(SPLIT_RUNS) });
  const back = await restore(s, { name: 'letter.docx', type: '', bytes: cleaned.bytes });
  const xml = strFromU8(unzipSync(back.bytes)['word/document.xml']);
  assert.equal(extractOoxmlText(xml, 'w:t', ['w:p']), 'Call Maria Gonzalez at maria@x.io for Smith & Sons\nSecond line\n');
  assert.match(xml, /Smith &amp; Sons/);
});

test('restoring a file with no known placeholders reports it unchanged', async () => {
  const back = await restore(session(), file('plain.txt', 'Hello [PERSON_9]'));
  assert.equal(back.status, 'unchanged');
});

// ---------- segment rewriting ----------

test('rewriteSegments puts the placeholder where the value starts and removes the rest', () => {
  const segments = [{ start: 0, end: 7 }, { start: 7, end: 15 }, { start: 15, end: 22 }];
  //                 "Call Ma"            "ria Gonz"            "alez ok"
  const out = rewriteSegments('Call Maria Gonzalez ok', segments, [{ start: 5, end: 19, text: '[PERSON_1]' }]);
  assert.deepEqual(out, ['Call [PERSON_1]', '', ' ok']);
});

test('rewriteSegments places a value that starts between segments in the next one', () => {
  // Text "A\nBob" where "\n" is a paragraph break outside any segment.
  const out = rewriteSegments('A\nBob', [{ start: 0, end: 1 }, { start: 2, end: 5 }], [{ start: 1, end: 5, text: '[X]' }]);
  assert.deepEqual(out, ['A', '[X]']);
});

test('all-lowercase file names are left alone (tool and product words)', async () => {
  let calls = 0;
  const anonymizeText = async (text) => {
    calls += 1;
    return text === 'openpyxl'
      ? { text: '[ORGANIZATION_9]', replacements: [{ placeholder: '[ORGANIZATION_9]', type: 'ORGANIZATION', original: 'openpyxl', start: 0, end: 8 }] }
      : { text, replacements: [] };
  };
  const out = await anonymizeFile(file('openpyxl.txt', 'nothing here'), { anonymizeText, zip: fflate });
  assert.equal(out.name, 'openpyxl.txt');
  assert.equal(out.replacements.length, 0);
  assert.equal(calls, 1, 'only the contents were checked');
});

// ---------- real files from real producers (tests/fixtures/make-fixtures.py) ----------


const FIXTURES = new URL('./fixtures/', import.meta.url);
const SENSITIVE = ['Maria', 'Gonzalez', 'maria.gonzalez', '7946 0958', '4111 1111', 'Northwind Traders', 'GB82'];

for (const name of readdirSync(FIXTURES).filter((n) => /\.(docx|xlsx|pptx)$/.test(n))) {
  test(`real file ${name}: nothing sensitive is left in any part, and restore round-trips`, async () => {
    const s = session();
    const bytes = new Uint8Array(readFileSync(new URL(name, FIXTURES)));
    const cleaned = await run(s, { name, type: '', bytes });
    assert.equal(cleaned.status, 'cleaned');
    const parts = unzipSync(cleaned.bytes);
    for (const [path, data] of Object.entries(parts)) {
      if (!/\.xml$/.test(path)) continue;
      const xml = strFromU8(data);
      // Excel cells stored as numbers are out of scope (reported in notes).
      const checked = path.includes('worksheets') ? xml.replace(/<v>\d+<\/v>/g, '') : xml;
      for (const value of SENSITIVE) assert.ok(!checked.includes(value), `${value} left in ${path}`);
    }
    const back = await restore(s, { name, type: '', bytes: cleaned.bytes });
    const original = unzipSync(bytes);
    const restoredParts = unzipSync(back.bytes);
    for (const [path, , tag, breaks] of Object.entries(original).map(([p]) => [p, null, ...partRule(name, p)])) {
      if (!tag) continue;
      assert.equal(
        extractOoxmlText(strFromU8(restoredParts[path]), tag, breaks),
        extractOoxmlText(strFromU8(original[path]), tag, breaks),
        `${path} text differs after restore`,
      );
    }
  });
}

function partRule(fileName, path) {
  const kind = fileName.split('.').pop();
  const rules = {
    docx: [[/^word\/(document|header\d*|footer\d*|comments)\.xml$/, 'w:t', ['w:p']]],
    xlsx: [[/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/, 't', ['si', 'is']]],
    pptx: [[/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/, 'a:t', ['a:p']]],
  };
  const rule = rules[kind].find(([re]) => re.test(path));
  return rule ? [rule[1], rule[2]] : [null, null];
}

test('an Office file that unpacks to more than the limit is refused (zip bomb)', async () => {
  const bytes = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': new Uint8Array(5000) });
  const out = await anonymizeFile({ name: 'bomb.docx', type: '', bytes }, { anonymizeText: session().anonymizeText, zip: fflate, maxUnpackedBytes: 1000 });
  assert.equal(out.status, 'unsupported');
  assert.match(out.reason, /too large when unpacked/);
});

// ---------- review findings: hidden text, metadata, JSON fidelity, performance ----------

const zipOf = (entries) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
const allText = (bytes) => Object.entries(unzipSync(bytes)).filter(([p]) => /\.(xml|rels)$/.test(p)).map(([, b]) => strFromU8(b)).join(' ');
const cleanZip = async (name, entries) => run(session(), { name, type: '', bytes: zipOf(entries) });

test('docx: tracked deletions, field codes, glossary and custom properties are cleaned', async () => {
  const doc = `<w:document ${W}><w:body><w:p><w:del><w:r><w:delText>Maria Gonzalez</w:delText></w:r></w:del>`
    + '<w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:maria@x.io" </w:instrText></w:r></w:p></w:body></w:document>';
  const out = await cleanZip('a.docx', {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': doc,
    'word/glossary/document.xml': `<w:glossaryDocument ${W}><w:p><w:r><w:t>Signed, Maria Gonzalez</w:t></w:r></w:p></w:glossaryDocument>`,
    'docProps/custom.xml': '<Properties><property name="Owner"><vt:lpwstr>Maria Gonzalez</vt:lpwstr></property></Properties>',
  });
  const text = allText(out.bytes);
  assert.ok(!text.includes('Maria') && !text.includes('maria@'), text);
});

test('docx: external link targets and user paths in relationships are cleaned', async () => {
  const rels = '<Relationships><Relationship Id="r1" Type="hyperlink" Target="mailto:maria@x.io" TargetMode="External"/>'
    + '<Relationship Id="r2" Type="attachedTemplate" Target="file:///C:\\Users\\Maria Gonzalez\\Templates\\Normal.dotm" TargetMode="External"/>'
    + '<Relationship Id="r3" Type="styles" Target="styles.xml"/></Relationships>';
  const out = await cleanZip('a.docx', {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
    'word/_rels/document.xml.rels': rels,
  });
  const relsOut = strFromU8(unzipSync(out.bytes)['word/_rels/document.xml.rels']);
  assert.ok(!relsOut.includes('maria@') && !relsOut.includes('Maria Gonzalez'), relsOut);
  assert.match(relsOut, /Target="styles\.xml"/, 'internal targets untouched');
});

test('docx: user ids in people.xml and the preview thumbnail are removed', async () => {
  const out = await cleanZip('a.docx', {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
    'word/people.xml': '<w15:people><w15:person w15:author="Maria Gonzalez"><w15:presenceInfo w15:providerId="AD" w15:userId="S::maria@northwind.com::1234"/></w15:person></w15:people>',
    'docProps/thumbnail.jpeg': new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]),
  });
  const parts = unzipSync(out.bytes);
  assert.ok(!strFromU8(parts['word/people.xml']).includes('maria@'));
  assert.notDeepEqual([...parts['docProps/thumbnail.jpeg']], [0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  assert.ok(out.notes.some((n) => /preview/i.test(n)), out.notes.join(' | '));
});

test('docx: CDATA text is refused rather than passed through unread', async () => {
  const out = await cleanZip('a.docx', {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t><![CDATA[Maria Gonzalez]]></w:t></w:r></w:p></w:body></w:document>`,
  });
  assert.equal(out.status, 'unsupported');
});

test('docx: custom XML data is reported as not checked', async () => {
  const out = await cleanZip('a.docx', {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Maria Gonzalez</w:t></w:r></w:p></w:body></w:document>`,
    'customXml/item1.xml': '<root><owner>someone</owner></root>',
  });
  assert.ok(out.notes.some((n) => /custom XML/i.test(n)), out.notes.join(' | '));
});

test('pptx: legacy and modern comments, comment authors and slide titles are cleaned', async () => {
  const out = await cleanZip('deck.pptx', {
    '[Content_Types].xml': '<Types/>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Q3 review</a:t></a:r></a:p></p:sld>',
    'ppt/comments/comment1.xml': '<p:cmLst><p:cm authorId="0"><p:text>Ask Maria Gonzalez</p:text></p:cm></p:cmLst>',
    'ppt/comments/modernComment_100.xml': '<p188:cmLst><p188:cm><p188:txBody><a:p><a:r><a:t>maria@x.io approved</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>',
    'ppt/authors.xml': '<p188:authorLst><p188:author id="1" name="Maria Gonzalez" initials="MG" userId="maria@x.io"/></p188:authorLst>',
    'docProps/app.xml': '<Properties><TitlesOfParts><vt:vector><vt:lpstr>Plan for Maria Gonzalez</vt:lpstr></vt:vector></TitlesOfParts></Properties>',
  });
  const text = allText(out.bytes);
  assert.ok(!text.includes('Maria') && !text.includes('maria@'), text);
});

test('xlsx: pivot caches, threaded comments, persons and file paths are cleaned', async () => {
  const out = await cleanZip('Book.xlsx', {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook><x15ac:absPath url="C:\\Users\\Maria Gonzalez\\Documents\\" xmlns:x15ac="x"/></workbook>',
    'xl/pivotCache/pivotCacheDefinition1.xml': '<pivotCacheDefinition><cacheFields><cacheField name="Owner"><sharedItems><s v="Maria Gonzalez"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>',
    'xl/pivotCache/pivotCacheRecords1.xml': '<pivotCacheRecords><r><s v="maria@x.io"/><n v="4"/></r></pivotCacheRecords>',
    'xl/threadedComments/threadedComment1.xml': '<ThreadedComments><threadedComment><text>Check with Maria Gonzalez</text></threadedComment></ThreadedComments>',
    'xl/persons/person.xml': '<personList><person displayName="Maria Gonzalez" userId="maria@x.io" providerId="AD"/></personList>',
  });
  const text = allText(out.bytes);
  assert.ok(!text.includes('Maria') && !text.includes('maria@'), text);
});

test('JSON: keys are cleaned and numbers and layout are kept byte for byte', async () => {
  const json = '[\n  {\n    "id": 12345678901234567890,\n    "ratio": 1.0,\n    "big": 1e3,\n    "Maria Gonzalez": "maria@x.io"\n  }\n]\n';
  const out = await run(session(), file('data.json', json));
  assert.equal(strFromU8(out.bytes), '[\n  {\n    "id": 12345678901234567890,\n    "ratio": 1.0,\n    "big": 1e3,\n    "[PERSON_1]": "[EMAIL_1]"\n  }\n]\n');
});

test('JSON: escaped characters in strings survive cleaning', async () => {
  const json = '{"note":"Line\\nTwo \\"quoted\\" \\u00e9 for Maria Gonzalez"}';
  const out = await run(session(), file('data.json', json));
  assert.deepEqual(JSON.parse(strFromU8(out.bytes)), { note: 'Line\nTwo "quoted" \u00e9 for [PERSON_1]' });
});

test('an out-of-range character reference does not crash cleaning', async () => {
  const out = await cleanZip('a.docx', {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>&#9999999999; Maria Gonzalez</w:t></w:r></w:p></w:body></w:document>`,
  });
  assert.notEqual(out.status, undefined);
});

test('rewriteSegments stays fast with tens of thousands of replacements', () => {
  const n = 60000;
  const text = 'ab '.repeat(n);
  const segments = Array.from({ length: n }, (_, i) => ({ start: i * 3, end: i * 3 + 3 }));
  const spans = Array.from({ length: n }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: 'X' }));
  const started = Date.now();
  const out = rewriteSegments(text, segments, spans);
  assert.ok(Date.now() - started < budget(500), `took ${Date.now() - started}ms`);
  assert.equal(out[0], 'X ');
});

test('malformed XML cannot make the scanner hang', () => {
  const started = Date.now();
  extractOoxmlText(`<w:t ${'a '.repeat(200000)}`, 'w:t', ['w:p']);
  assert.ok(Date.now() - started < budget(500), `took ${Date.now() - started}ms`);
});

test('hyphenated file names are cleaned and restored with their separators', async () => {
  const s = session();
  const out = await run(s, file('Maria-Gonzalez-CV.txt', 'hello'));
  assert.equal(out.name, '[PERSON_1]-CV.txt');
  const back = await restore(s, { name: out.name, type: '', bytes: out.bytes });
  assert.equal(back.name, 'Maria-Gonzalez-CV.txt');
});

test('the name of a file that cannot be checked is still cleaned', async () => {
  const out = await run(session(), { name: 'Maria Gonzalez passport.pdf', type: 'application/pdf', bytes: new Uint8Array([37, 80]) });
  assert.equal(out.status, 'unsupported');
  assert.equal(out.name, '[PERSON_1] passport.pdf');
});

test('restore does not repeat notes that only apply to cleaning', async () => {
  const s = session();
  const book = zipOf({ '[Content_Types].xml': '<Types/>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>4</v></c><c t="inlineStr"><is><t>[PERSON_1]</t></is></c></row></sheetData></worksheet>' });
  await s.anonymizeText('Maria Gonzalez');
  const back = await restore(s, { name: 'b.xlsx', type: '', bytes: book });
  assert.deepEqual(back.notes, []);
});
