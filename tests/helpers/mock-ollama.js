// Minimal Ollama stand-in for tests. "Detects" entities by looking up a fixed
// dictionary in the prompt text, which is enough to exercise the full
// request/parse/replace pipeline.

import { createServer } from 'node:http';

export const KNOWN_ENTITIES = Object.freeze([
  { text: 'Maria Gonzalez', type: 'PERSON' },
  { text: 'Northwind Traders', type: 'ORGANIZATION' },
  { text: '221B Baker Street', type: 'ADDRESS' },
]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function startMockOllama({ port = 0, host = '127.0.0.1', rejectOrigin = false } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const reply = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };

    if (rejectOrigin && req.headers.origin) return reply(403, {});
    if (req.url === '/api/tags') return reply(200, { models: [{ name: 'llama3.2:latest' }] });
    if (req.url === '/api/chat' && req.method === 'POST') {
      const { messages } = JSON.parse(body);
      const userText = messages.at(-1).content;
      const entities = KNOWN_ENTITIES.filter((e) => userText.includes(e.text));
      return reply(200, { message: { role: 'assistant', content: JSON.stringify({ entities }) } });
    }
    return reply(404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://127.0.0.1:${actual}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
