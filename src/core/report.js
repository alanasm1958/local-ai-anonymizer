// Human-readable reporting: what one anonymize run replaced, and a running
// tally for the browser session. Pure: the worker stores the stats.

import { ANY_SITE } from './vault.js';

const NOUNS = Object.freeze({
  PERSON: ['name', 'names'],
  ORGANIZATION: ['organization', 'organizations'],
  LOCATION: ['place', 'places'],
  EMAIL: ['email', 'emails'],
  PHONE: ['phone number', 'phone numbers'],
  CREDIT_CARD: ['card number', 'card numbers'],
  SSN: ['SSN', 'SSNs'],
  IP_ADDRESS: ['IP address', 'IP addresses'],
  IBAN: ['IBAN', 'IBANs'],
  API_KEY: ['key or secret', 'keys and secrets'],
  URL: ['URL', 'URLs'],
  DATE_OF_BIRTH: ['date of birth', 'dates of birth'],
  ID_NUMBER: ['ID number', 'ID numbers'],
  ADDRESS: ['address', 'addresses'],
  POSTCODE: ['postcode', 'postcodes'],
});

// Order used when counts tie: people first, then contact details, then the rest.
const TYPE_ORDER = Object.keys(NOUNS);
const typeOrder = (type) => (TYPE_ORDER.includes(type) ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length);
const byCountThenType = (a, b) => b.items - a.items || typeOrder(a.type) - typeOrder(b.type);

const typeOfPlaceholder = (placeholder) => /^\[([A-Z][A-Z_]*?)_\d+\]$/.exec(placeholder)?.[1];

const noun = (type, n) => {
  const [one, many] = NOUNS[type] ?? [type.toLowerCase(), `${type.toLowerCase()}s`];
  return n === 1 ? one : many;
};

// items = distinct values (one placeholder each); mentions = occurrences.
export function summarizeReplacements(replacements) {
  const perType = new Map();
  replacements.forEach(({ placeholder, type }) => {
    const entry = perType.get(type) ?? { placeholders: new Set(), mentions: 0 };
    entry.placeholders.add(placeholder);
    entry.mentions += 1;
    perType.set(type, entry);
  });
  const byType = [...perType.entries()]
    .map(([type, e]) => ({ type, items: e.placeholders.size, mentions: e.mentions }))
    .sort(byCountThenType);
  return {
    items: byType.reduce((n, t) => n + t.items, 0),
    mentions: byType.reduce((n, t) => n + t.mentions, 0),
    byType,
  };
}

// "2 names (3 mentions)"
export const describeCount = ({ type, items, mentions }) =>
  `${items} ${noun(type, items)}${mentions > items ? ` (${mentions} mentions)` : ''}`;

// "2 names (3 mentions), 1 email, 1 card number"
export const formatBreakdown = (byType) => byType.map(describeCount).join(', ');

export const emptyStats = () => ({ runs: 0, mentionsByType: {} });

export function recordRun(stats, summary) {
  if (summary.items === 0) return stats;
  const mentionsByType = { ...stats.mentionsByType };
  summary.byType.forEach(({ type, mentions }) => {
    mentionsByType[type] = (mentionsByType[type] ?? 0) + mentions;
  });
  return { runs: stats.runs + 1, mentionsByType };
}

const SITE_LABELS = Object.freeze({ [ANY_SITE]: 'Popup' });

// Session view: distinct values by type and by site come from the vault;
// run and mention counts from the stats kept next to it.
export function sessionTally(vault, stats) {
  const placeholders = Object.keys(vault.byPlaceholder);
  const typeCounts = new Map();
  placeholders.forEach((p) => {
    const type = typeOfPlaceholder(p);
    if (type) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  });
  const siteCounts = new Map();
  placeholders.forEach((p) => (vault.sites?.[p] ?? []).forEach((site) => {
    siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1);
  }));
  const mentionsByType = stats?.mentionsByType ?? {};
  const byType = [...typeCounts.entries()]
    .map(([type, items]) => ({ type, items, mentions: Math.max(mentionsByType[type] ?? 0, items) }))
    .sort(byCountThenType);
  return {
    items: placeholders.length,
    runs: stats?.runs ?? 0,
    mentions: byType.reduce((n, t) => n + t.mentions, 0),
    byType,
    bySite: [...siteCounts.entries()]
      .map(([site, items]) => ({ site: SITE_LABELS[site] ?? site, items }))
      .sort((a, b) => b.items - a.items || (a.site === 'Popup') - (b.site === 'Popup') || a.site.localeCompare(b.site)),
  };
}
