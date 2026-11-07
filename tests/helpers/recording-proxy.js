// HTTP proxy for e2e tests that records every host the browser tries to
// reach and refuses the connection. Pointing Chromium at it proves which
// outbound requests (if any) the extension makes.

import { createServer } from 'node:http';

// A proxy can't tell who asked, so allow only what is known not to be the
// extension: Chrome's own background services, and the connection Chrome
// opens to the fake AI sites before context.route serves them. Any other
// host (a model hub, a CDN, an analytics endpoint) is unexpected.
// Chromium's own services also use gvt1/gvt2 (component updater) and
// googleusercontent on fresh CI machines.
const BROWSER_OR_TEST = /(^|\.)(google\.com|googleapis\.com|gstatic\.com|gvt1\.com|gvt2\.com|googleusercontent\.com|chatgpt\.com|claude\.ai)(:\d+)?$/;

export const unexpectedHosts = (hosts) => [...new Set(hosts)].filter((host) => !BROWSER_OR_TEST.test(host));

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
