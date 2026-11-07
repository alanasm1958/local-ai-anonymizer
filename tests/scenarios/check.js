// Judges one scenario output. Whole-word and case-sensitive, so "ali" is not
// found inside "quality" and "Omar" does not stand in for "omar".

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordIn = (text, value) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'u').test(text);

export const PLACEHOLDER = /\[[A-Z][A-Z_]*_\d+\]/g;

// Returns { status, leaked, overRedacted, knownLeft, notes } where status is
// 'pass', 'fail', 'known' (a documented gap) or 'fixed' (a gap that now passes).
export function judge(output, kase) {
  const knownMiss = kase.knownMiss ?? [];
  const leaked = (kase.remove ?? []).filter((v) => wordIn(output, v));
  const overRedacted = (kase.keep ?? []).filter((v) => !output.includes(v));
  const knownLeft = knownMiss.filter((v) => wordIn(output, v));
  const placeholders = [...new Set(output.match(PLACEHOLDER) ?? [])];
  const notes = kase.onePlaceholder && placeholders.length !== 1
    ? [`expected one placeholder for every spelling, got ${placeholders.join(', ') || 'none'}`]
    : [];
  const clean = leaked.length === 0 && overRedacted.length === 0 && notes.length === 0;
  let status = clean ? 'pass' : 'fail';
  if (kase.known) status = clean ? 'fixed' : 'known';
  return { status, leaked, overRedacted, knownLeft, notes };
}
