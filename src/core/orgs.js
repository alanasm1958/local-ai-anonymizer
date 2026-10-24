// Rule-based organization names: capitalized words ending in a company-type
// word ("Northwind Traders", "Harbor & Finch LLP", "Stanford University").
// Complements the model, which can miss an organization at the start of a
// sentence or paragraph. Quantifiers are bounded and gaps never cross a line.

// Only words that almost always end a company or institution name. Generic
// words ("Group", "Systems", "Services", "Trust") also end ordinary Title
// Case phrases ("Machine Learning Systems") and were dropped after review.
const SUFFIXES = [
  'Ltd', 'Limited', 'Inc', 'Incorporated', 'LLC', 'LLP', 'PLC', 'GmbH', 'AG', 'SA', 'SAS', 'BV', 'NV', 'AS',
  'AB', 'Oy', 'Pty', 'Corp', 'Corporation', 'Company', 'Holdings', 'Sons', 'Brothers', 'Bros', 'Bank',
  'University', 'College', 'Hospital', 'Clinic', 'Traders', 'Logistics', 'Insurance', 'Pharmaceuticals',
  'Motors', 'Airlines',
];

// Words that start sentences or commands rather than names.
const LEADING_WORDS = new Set([
  'the', 'a', 'an', 'our', 'your', 'my', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those',
  'at', 'in', 'on', 'for', 'from', 'to', 'with', 'by', 'and', 'or', 'of', 'dear', 'hi', 'hello', 'please',
  'call', 'email', 'ask', 'tell', 'contact', 'ping', 'pay', 'visit', 'meet', 'thanks', 'cc', 'attn',
  'yesterday', 'today', 'tomorrow', 'when', 'if', 'then', 'so', 'but', 'also', 'after', 'before', 'since', 'while',
  // Command verbs that open prompts.
  'explain', 'use', 'compare', 'write', 'summarize', 'summarise', 'join', 'review', 'draft', 'create', 'build',
  'analyze', 'analyse', 'describe', 'translate', 'check', 'find', 'show', 'list', 'give', 'make', 'introduction',
]);

const WORD = "[A-Z][A-Za-z0-9'’-]{0,30}";
const GAP = '[ \\t]{1,3}';
const ORG_RE = new RegExp(
  `(?<![A-Za-z0-9])((?:${WORD}(?:${GAP}&)?${GAP}){1,4})(${SUFFIXES.join('|')})(?![A-Za-z0-9])`,
  'gd',
);

// Drops leading words like "Call" or "The"; returns the offset of the first kept word.
function trimLeading(value) {
  let offset = 0;
  for (;;) {
    const match = /^(\S+)[ \t]+/.exec(value.slice(offset));
    if (!match || !LEADING_WORDS.has(match[1].toLowerCase())) return offset;
    offset += match[0].length;
  }
}

export function orgSuffixSpans(text) {
  if (!text) return [];
  const spans = [];
  for (const match of text.matchAll(ORG_RE)) {
    const value = match[0];
    const from = trimLeading(value);
    const name = value.slice(from, value.length - match[2].length).trim();
    if (!/[A-Za-z]/.test(name.replace(/&/g, ''))) continue; // nothing but the company word
    const start = match.index + from;
    spans.push({ start, end: match.index + value.length, type: 'ORGANIZATION', value: text.slice(start, match.index + value.length), source: 'model' });
  }
  return spans;
}
