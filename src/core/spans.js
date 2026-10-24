// Overlap resolution for detected spans: { start, end, type, value, source }.

const SOURCE_RANK = Object.freeze({ pattern: 0, model: 1 });

// When two pattern spans cover the same text, the more specific type wins.
const TYPE_RANK = Object.freeze([
  'API_KEY', 'EMAIL', 'URL', 'IBAN', 'CREDIT_CARD', 'SSN', 'DATE_OF_BIRTH', 'ID_NUMBER',
  'IP_ADDRESS', 'PHONE', 'ADDRESS', 'POSTCODE', 'PERSON', 'ORGANIZATION', 'LOCATION',
]);

const typeRank = (type) => {
  const i = TYPE_RANK.indexOf(type);
  return i === -1 ? TYPE_RANK.length : i;
};

const compareByPriority = (a, b) =>
  (SOURCE_RANK[a.source] ?? 2) - (SOURCE_RANK[b.source] ?? 2)
  || (b.end - b.start) - (a.end - a.start)
  || typeRank(a.type) - typeRank(b.type)
  || a.start - b.start;

// Index of the first kept span whose start is >= `start` (kept is sorted by start).
function lowerBound(kept, start) {
  let lo = 0;
  let hi = kept.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kept[mid].start < start) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Greedy pick by priority. `kept` stays sorted by start, so each overlap check
// only looks at the two neighbours: O(n log n) instead of O(n^2).
export function resolveSpans(spans) {
  const kept = [];
  [...spans]
    .filter((s) => s.end > s.start)
    .sort(compareByPriority)
    .forEach((span) => {
      const i = lowerBound(kept, span.start);
      const prev = kept[i - 1];
      const next = kept[i];
      if ((prev && prev.end > span.start) || (next && next.start < span.end)) return;
      kept.splice(i, 0, span);
    });
  return kept;
}
