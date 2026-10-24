// Local model client (Ollama or OpenAI-compatible) plus pure helpers for
// prompting and parsing. The model only *finds* entities; replacement is
// always done deterministically in anonymizer.js, so a confused model can
// never rewrite or drop the user's text.

import { MODEL_TYPES } from './settings.js';
import { PLACEHOLDER_RE } from './vault.js';

export const DEFAULT_CHUNK_SIZE = 2500;

const TYPE_SYNONYMS = Object.freeze({
  PERSON: 'PERSON', NAME: 'PERSON', PER: 'PERSON', PEOPLE: 'PERSON', FULL_NAME: 'PERSON',
  ORGANIZATION: 'ORGANIZATION', ORGANISATION: 'ORGANIZATION', ORG: 'ORGANIZATION', COMPANY: 'ORGANIZATION',
  ADDRESS: 'ADDRESS', STREET_ADDRESS: 'ADDRESS',
  LOCATION: 'LOCATION', LOC: 'LOCATION', PLACE: 'LOCATION', CITY: 'LOCATION', COUNTRY: 'LOCATION',
  ID_NUMBER: 'ID_NUMBER', ID: 'ID_NUMBER', ACCOUNT_NUMBER: 'ID_NUMBER', PASSPORT: 'ID_NUMBER',
});

const TYPE_HINTS = Object.freeze({
  PERSON: 'names of real people (first, last or full names, nicknames)',
  ORGANIZATION: 'company, employer, client, school, hospital or agency names',
  ADDRESS: 'street addresses, postal codes with street, P.O. boxes',
  LOCATION: 'cities, regions, countries, buildings',
  ID_NUMBER: 'passport, national ID, employee, customer, account, policy, case or invoice numbers',
});

export function buildMessages(text, types) {
  const wanted = types.filter((t) => MODEL_TYPES.includes(t));
  const list = wanted.map((t) => `- ${t}: ${TYPE_HINTS[t]}`).join('\n');
  const system = [
    'You are a privacy filter. Find sensitive entities in the user text.',
    'Return ONLY JSON of the form {"entities":[{"text":"<exact substring>","type":"<TYPE>"}]}.',
    'Rules:',
    '- "text" must be copied exactly as it appears in the input, same spelling and case.',
    '- Only use these types:',
    list,
    '- Do not include generic words, job titles, product names, or public figures mentioned only in passing.',
    '- Ignore placeholders that look like [PERSON_1].',
    '- If nothing is found return {"entities":[]}.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: 'Text:\n"""\nAlice Moreno from Brightline Ltd lives at 12 Elm Street.\n"""' },
    { role: 'assistant', content: '{"entities":[{"text":"Alice Moreno","type":"PERSON"},{"text":"Brightline Ltd","type":"ORGANIZATION"},{"text":"12 Elm Street","type":"ADDRESS"}]}' },
    { role: 'user', content: `Text:\n"""\n${text}\n"""` },
  ];
}

const stripFences = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

function toJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

const PLACEHOLDER_ONLY = new RegExp(`^${PLACEHOLDER_RE.source}$`);

export function parseEntities(raw) {
  const data = toJson(raw);
  const list = Array.isArray(data) ? data : Array.isArray(data?.entities) ? data.entities : [];
  return list
    .filter((e) => e && typeof e.text === 'string' && typeof e.type === 'string')
    .map((e) => ({ text: e.text.trim(), type: TYPE_SYNONYMS[e.type.trim().toUpperCase().replace(/[\s-]+/g, '_')] }))
    .filter((e) => e.type && e.text.length >= 2 && !PLACEHOLDER_ONLY.test(e.text));
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word match that still works when the entity starts or ends with punctuation.
function occurrenceRegex(needle) {
  const head = /^\w/.test(needle) ? '(?<!\\w)' : '';
  const tail = /\w$/.test(needle) ? '(?!\\w)' : '';
  return new RegExp(`${head}${escapeRegex(needle)}${tail}`, 'g');
}

export function entitiesToSpans(text, entities) {
  return entities.flatMap((entity) =>
    [...text.matchAll(occurrenceRegex(entity.text))].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      type: entity.type,
      value: m[0],
      source: 'model',
    })));
}

// Splits on paragraph, then line, then sentence, then space boundaries so a
// small model never sees a cut-off name. Offsets point into the original text.
export function chunkText(text, maxChars = DEFAULT_CHUNK_SIZE) {
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    const rest = text.slice(offset);
    if (rest.length <= maxChars) {
      chunks.push({ text: rest, offset });
      break;
    }
    const window = rest.slice(0, maxChars);
    const cut = ['\n\n', '\n', '. ', ' ']
      .map((sep) => window.lastIndexOf(sep))
      .find((i) => i > maxChars / 2);
    const size = cut === undefined ? maxChars : cut + 1;
    chunks.push({ text: rest.slice(0, size), offset });
    offset += size;
  }
  return chunks;
}

const trimSlash = (s) => s.replace(/\/+$/, '');

function openaiBase(endpoint) {
  const base = trimSlash(endpoint);
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

const PROVIDER_API = Object.freeze({
  ollama: {
    chatUrl: (endpoint) => `${trimSlash(endpoint)}/api/chat`,
    modelsUrl: (endpoint) => `${trimSlash(endpoint)}/api/tags`,
    chatBody: (model, messages) => ({
      model, messages, stream: false, format: 'json', keep_alive: '10m', options: { temperature: 0 },
    }),
    readContent: (body) => body?.message?.content,
    readModels: (body) => (body?.models ?? []).map((m) => m.name),
  },
  openai: {
    chatUrl: (endpoint) => `${openaiBase(endpoint)}/chat/completions`,
    modelsUrl: (endpoint) => `${openaiBase(endpoint)}/models`,
    chatBody: (model, messages) => ({
      model, messages, stream: false, temperature: 0, response_format: { type: 'json_object' },
    }),
    readContent: (body) => body?.choices?.[0]?.message?.content,
    readModels: (body) => (body?.data ?? []).map((m) => m.id),
  },
});

// Chrome kills an MV3 worker whose single event runs past 5 minutes, so the
// whole multi-chunk detection must finish well inside that.
export const DEFAULT_TOTAL_TIMEOUT_MS = 240000;

export function createModelClient({
  provider, endpoint, model, fetchImpl = globalThis.fetch, timeoutMs = 60000,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS, chunkSize = DEFAULT_CHUNK_SIZE,
}) {
  const api = PROVIDER_API[provider];
  if (!api) throw new Error(`Unknown provider "${provider}"`);

  async function request(url, body, limitMs = timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    try {
      const res = await fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(describeHttpError(res.status, url));
      return await res.json();
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error(`Local model timed out after ${Math.round(limitMs / 1000)}s`);
      if (err instanceof TypeError) throw new Error(`Cannot reach local model at ${endpoint}. Is it running?`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function detectChunk(text, types, limitMs) {
    const body = await request(api.chatUrl(endpoint), api.chatBody(model, buildMessages(text, types)), limitMs);
    return parseEntities(api.readContent(body) ?? '');
  }

  async function detectEntities(text, types) {
    if (!text.trim() || types.length === 0) return [];
    const deadline = Date.now() + totalTimeoutMs;
    const tooSlow = new Error(`Local model took longer than ${Math.round(totalTimeoutMs / 1000)}s for this text. Try a smaller paste or a faster model.`);
    const found = [];
    // Sequential on purpose: local models serve one request at a time anyway.
    for (const chunk of chunkText(text, chunkSize)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw tooSlow;
      try {
        found.push(...await detectChunk(chunk.text, types, Math.min(timeoutMs, remaining)));
      } catch (err) {
        if (Date.now() >= deadline) throw tooSlow;
        throw err;
      }
    }
    return [...new Map(found.map((e) => [`${e.type}:${e.text}`, e])).values()];
  }

  async function listModels() {
    return api.readModels(await request(api.modelsUrl(endpoint)));
  }

  return { detectEntities, listModels };
}

function describeHttpError(status, url) {
  if (status === 403) return `Local model refused the request (HTTP 403). For Ollama, set OLLAMA_ORIGINS=chrome-extension://* and restart it.`;
  if (status === 404) return `Model or endpoint not found (HTTP 404) at ${url}. Check the model name in Options.`;
  return `Local model returned HTTP ${status}`;
}
