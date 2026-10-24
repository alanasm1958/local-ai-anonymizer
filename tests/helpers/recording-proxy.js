// HTTP proxy for e2e tests that records every host the browser tries to
// reach and refuses the connection. Pointing Chromium at it proves which
// outbound requests (if any) the extension makes.

import { createServer } from 'node:http';

export function startRecordingProxy() {
  const hosts = [];
  const server = createServer((req, res) => {
    // Plain-HTTP proxy requests carry an absolute URL.
    try {
      hosts.push(new URL(req.url).host);
    } catch {
      hosts.push(req.headers.host ?? req.url);
    }
    res.writeHead(403).end();
  });
  // HTTPS goes through CONNECT host:port.
  server.on('connect', (req, socket) => {
    hosts.push(req.url);
    // The browser often resets a refused connection; that is expected.
    socket.on('error', () => undefined);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hosts,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
