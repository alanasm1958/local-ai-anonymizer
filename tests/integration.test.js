import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOllama } from './helpers/mock-ollama.js';
import { createModelClient } from '../src/core/llm.js';
import { anonymize, restoreText } from '../src/core/anonymizer.js';
import { createVault } from '../src/core/vault.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

let server;

before(async () => { server = await startMockOllama(); });
after(async () => { await server.close(); });

const client = () => createModelClient({ provider: 'ollama', endpoint: server.url, model: 'llama3.2' });

test('full pipeline against a real HTTP server round-trips text', async () => {
  const text = [
    'Hi team, Maria Gonzalez (maria.g@northwind.example, +44 20 7946 0958) from Northwind Traders',
    'lives at 221B Baker Street. Card on file: 4111 1111 1111 1111. Server 10.0.4.17.',
    'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  ].join('\n');

  const result = await anonymize(text, {
    settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: client().detectEntities,
  });

  for (const secret of ['Maria Gonzalez', 'maria.g@', '7946', 'Northwind Traders', 'Baker Street', '4111', '10.0.4.17', 'ghp_']) {
    assert.equal(result.text.includes(secret), false, `${secret} leaked: ${result.text}`);
  }
  assert.match(result.text, /\[PERSON_1\]/);
  assert.match(result.text, /\[ORGANIZATION_1\]/);
  assert.match(result.text, /\[ADDRESS_1\]/);
  assert.deepEqual(result.warnings, []);
  assert.equal(restoreText(result.text, result.vault).text, text);

  const chat = server.requests.find((r) => r.url === '/api/chat');
  assert.equal(JSON.parse(chat.body).format, 'json');
});

test('listModels reads /api/tags', async () => {
  assert.deepEqual(await client().listModels(), ['llama3.2:latest']);
});

test('unreachable server falls back to patterns with a clear warning', async () => {
  const dead = createModelClient({ provider: 'ollama', endpoint: 'http://127.0.0.1:9', model: 'm', timeoutMs: 2000 });
  const result = await anonymize('Maria Gonzalez, maria@x.io', {
    settings: DEFAULT_SETTINGS, vault: createVault(), detectEntities: dead.detectEntities,
  });
  assert.equal(result.text, 'Maria Gonzalez, [EMAIL_1]');
  assert.match(result.warnings[0], /Cannot reach local model/);
});

test('403 from an origin-checking server explains OLLAMA_ORIGINS', async () => {
  const strict = await startMockOllama({ rejectOrigin: true });
  try {
    const fetchWithOrigin = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: 'chrome-extension://abc' } });
    const c = createModelClient({ provider: 'ollama', endpoint: strict.url, model: 'm', fetchImpl: fetchWithOrigin });
    await assert.rejects(c.detectEntities('Maria Gonzalez', ['PERSON']), /OLLAMA_ORIGINS/);
  } finally {
    await strict.close();
  }
});
