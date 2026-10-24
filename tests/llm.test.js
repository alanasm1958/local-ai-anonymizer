import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntities, entitiesToSpans, chunkText, buildMessages, createModelClient } from '../src/core/llm.js';

test('parseEntities accepts several JSON shapes and normalizes types', () => {
  assert.deepEqual(parseEntities('{"entities":[{"text":"Jane","type":"name"}]}'), [{ text: 'Jane', type: 'PERSON' }]);
  assert.deepEqual(parseEntities([{ text: 'Acme', type: 'company' }]), [{ text: 'Acme', type: 'ORGANIZATION' }]);
  assert.deepEqual(parseEntities('```json\n{"entities":[{"text":"Paris","type":"LOCATION"}]}\n```'), [{ text: 'Paris', type: 'LOCATION' }]);
});

test('parseEntities drops junk, unknown types and one-letter strings', () => {
  const raw = { entities: [{ text: 'J', type: 'PERSON' }, { text: 'x', type: 'COLOR' }, null, { type: 'PERSON' }, { text: 'Jo Li', type: 'PERSON' }] };
  assert.deepEqual(parseEntities(raw), [{ text: 'Jo Li', type: 'PERSON' }]);
  assert.deepEqual(parseEntities('not json'), []);
  assert.deepEqual(parseEntities(42), []);
});

test('entitiesToSpans finds every whole-word occurrence', () => {
  const text = 'Ann met Annabel and Ann.';
  const spans = entitiesToSpans(text, [{ text: 'Ann', type: 'PERSON' }]);
  assert.deepEqual(spans.map((s) => s.start), [0, 20]);
  assert.ok(spans.every((s) => s.source === 'model' && text.slice(s.start, s.end) === 'Ann'));
});

test('entitiesToSpans ignores entities the model hallucinated', () => {
  assert.deepEqual(entitiesToSpans('hello world', [{ text: 'Bob', type: 'PERSON' }]), []);
});

test('entitiesToSpans escapes regex characters in entity text', () => {
  const spans = entitiesToSpans('Contact A.B. (Smith) now', [{ text: 'A.B. (Smith)', type: 'PERSON' }]);
  assert.equal(spans.length, 1);
});

test('chunkText keeps offsets and prefers paragraph breaks', () => {
  const text = `${'a'.repeat(30)}\n\n${'b'.repeat(30)}`;
  const chunks = chunkText(text, 40);
  assert.equal(chunks.length, 2);
  for (const c of chunks) assert.equal(text.slice(c.offset, c.offset + c.text.length), c.text);
  assert.equal(chunkText('short', 40).length, 1);
  assert.deepEqual(chunkText('', 40), []);
});

test('chunkText hard-splits text without break points', () => {
  const chunks = chunkText('x'.repeat(100), 40);
  assert.equal(chunks.map((c) => c.text).join(''), 'x'.repeat(100));
});

test('buildMessages lists the requested entity types', () => {
  const msgs = buildMessages('hi', ['PERSON', 'ADDRESS']);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /PERSON/);
  assert.match(msgs[0].content, /ADDRESS/);
  assert.equal(msgs.at(-1).content.includes('hi'), true);
});

const fakeFetch = (handler) => async (url, init) => {
  const { status = 200, body } = await handler(url, init ? JSON.parse(init.body ?? 'null') : null);
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
};

test('ollama client posts to /api/chat and parses entities', async () => {
  let seen;
  const fetchImpl = fakeFetch((url, body) => {
    seen = { url, body };
    return { body: { message: { content: '{"entities":[{"text":"Jane","type":"PERSON"}]}' } } };
  });
  const client = createModelClient({ provider: 'ollama', endpoint: 'http://localhost:11434/', model: 'llama3.2', fetchImpl });
  const entities = await client.detectEntities('Jane', ['PERSON']);
  assert.equal(seen.url, 'http://localhost:11434/api/chat');
  assert.equal(seen.body.stream, false);
  assert.equal(seen.body.model, 'llama3.2');
  assert.deepEqual(entities, [{ text: 'Jane', type: 'PERSON' }]);
});

test('openai-compatible client posts to /v1/chat/completions', async () => {
  let seenUrl;
  const fetchImpl = fakeFetch((url) => {
    seenUrl = url;
    return { body: { choices: [{ message: { content: '{"entities":[]}' } }] } };
  });
  const client = createModelClient({ provider: 'openai', endpoint: 'http://localhost:1234/v1', model: 'm', fetchImpl });
  assert.deepEqual(await client.detectEntities('x', ['PERSON']), []);
  assert.equal(seenUrl, 'http://localhost:1234/v1/chat/completions');
});

test('client dedupes entities across chunks', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { message: { content: '{"entities":[{"text":"Jane","type":"PERSON"}]}' } } }));
  const client = createModelClient({ provider: 'ollama', endpoint: 'http://h', model: 'm', fetchImpl, chunkSize: 10 });
  const entities = await client.detectEntities('Jane one.\n\nJane two.\n\nJane 3.', ['PERSON']);
  assert.deepEqual(entities, [{ text: 'Jane', type: 'PERSON' }]);
});

test('client reports HTTP errors with a helpful message', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 403, body: {} }));
  const client = createModelClient({ provider: 'ollama', endpoint: 'http://h', model: 'm', fetchImpl });
  await assert.rejects(client.detectEntities('x', ['PERSON']), /403/);
});

test('client lists models for both providers', async () => {
  const ollama = createModelClient({
    provider: 'ollama', endpoint: 'http://h', model: 'm',
    fetchImpl: fakeFetch(() => ({ body: { models: [{ name: 'llama3.2:latest' }] } })),
  });
  assert.deepEqual(await ollama.listModels(), ['llama3.2:latest']);
  const openai = createModelClient({
    provider: 'openai', endpoint: 'http://h/v1', model: 'm',
    fetchImpl: fakeFetch(() => ({ body: { data: [{ id: 'qwen' }] } })),
  });
  assert.deepEqual(await openai.listModels(), ['qwen']);
});

test('client times out slow models', async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const client = createModelClient({ provider: 'ollama', endpoint: 'http://h', model: 'm', fetchImpl, timeoutMs: 20 });
  await assert.rejects(client.detectEntities('x', ['PERSON']), /timed out/);
});

test('client enforces an overall deadline across chunks', async () => {
  const fetchImpl = fakeFetch(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return { body: { message: { content: '{"entities":[]}' } } };
  });
  const client = createModelClient({
    provider: 'ollama', endpoint: 'http://h', model: 'm', fetchImpl, chunkSize: 10, totalTimeoutMs: 50,
  });
  await assert.rejects(client.detectEntities('aaaa bbbb.\n\ncccc dddd.\n\neeee ffff.\n\ngggg', ['PERSON']), /took longer than/);
});
