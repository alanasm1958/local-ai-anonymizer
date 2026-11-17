// Seeded random numbers so every run builds the same cases. Each data family
// gets its own stream (keyed by name), so adding cases to one family does
// not change the values generated for another.

export const STRESS_SEED = 20261107;

const hash = (name) => [...name].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function rngFor(name, seed = STRESS_SEED) {
  let state = (hash(name) ^ seed) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  const digits = (n) => Array.from({ length: n }, () => String(int(0, 9))).join('');
  const chars = (n, alphabet) => Array.from({ length: n }, () => alphabet[int(0, alphabet.length - 1)]).join('');
  return Object.freeze({ next, int, pick, digits, chars });
}

export function luhnCheckDigit(partial) {
  const sum = [...partial].reverse().reduce((acc, ch, i) => {
    const n = Number(ch);
    if (i % 2 === 1) return acc + n;
    const doubled = n * 2;
    return acc + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return String((10 - (sum % 10)) % 10);
}

const mod97 = (numeric) => numeric.match(/.{1,7}/g).reduce((acc, part) => Number(String(acc) + part) % 97, 0);
const lettersToDigits = (s) => [...s].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');

export function makeIban(country, bban) {
  const check = 98 - mod97(lettersToDigits(`${bban}${country}00`));
  return `${country}${String(check).padStart(2, '0')}${bban}`;
}
