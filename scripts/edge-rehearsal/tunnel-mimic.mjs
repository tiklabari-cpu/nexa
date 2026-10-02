#!/usr/bin/env node
/**
 * A stand-in for the pilot's Cloudflare Tunnel, for the local edge rehearsal
 * (tm 257.10). See README.md next to this file for what it does and does not
 * prove.
 *
 * It routes by the ingress rules of infra/pilot/cloudflared/config.example.yml
 * — read from the file, first match wins, as cloudflared reads them — and does
 * to X-Forwarded-For what the tunnel does by default: the visitor's address is
 * appended to whatever the visitor sent, and the request reaches the service
 * from 127.0.0.1. It listens on IPv6 loopback, so the visitor of a local
 * rehearsal is `::1` — an address that is neither the spoof the probe sends
 * nor the 127.0.0.1 the api sees as its peer, which keeps the three apart in
 * the api's log.
 *
 * One JSON line per request on stdout records the visitor it saw, for the
 * probe to compare with the address the api derived.
 *
 *   EDGE_MIMIC_PORT         listen port on [::1] (default 8788)
 *   EDGE_MIMIC_APPEND_SELF  =1 also appends the edge's own address — a tunnel
 *                           that adds an entry of its own, for seeing what the
 *                           probe reports when the hop count is one short
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = resolve(REPO, 'infra/pilot/cloudflared/config.example.yml');
const PORT = Number(process.env.EDGE_MIMIC_PORT ?? 8788);
const APPEND_SELF = process.env.EDGE_MIMIC_APPEND_SELF === '1';
const DIAL_FROM = '127.0.0.1';

/** The `ingress:` rules, in order. The file's shape is pinned by env.pilot.test.ts. */
function ingressRules(source) {
  const rules = [];
  let inIngress = false;
  for (const raw of source.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    if (/^\S/.test(line)) {
      inIngress = line === 'ingress:';
      continue;
    }
    if (!inIngress) continue;
    const item = /^\s*(-\s+)?([a-zA-Z]+):\s*(\S+)$/.exec(line);
    if (!item) throw new Error(`${CONFIG}: cannot read ingress line: ${raw}`);
    if (item[1]) rules.push({});
    rules.at(-1)[item[2]] = item[3];
  }
  return rules;
}

const RULES = ingressRules(readFileSync(CONFIG, 'utf8'));

function match(hostHeader, url) {
  const host = (hostHeader ?? '').replace(/:\d+$/, '').toLowerCase();
  const path = new URL(url ?? '/', 'http://edge').pathname;
  return RULES.find(
    (rule) =>
      (!rule.hostname || rule.hostname === host) &&
      (!rule.path || new RegExp(rule.path).test(path)),
  );
}

const plain = (address) => (address ?? '').replace(/^::ffff:/, '');

/** The forwarded headers: the visitor appended to what the visitor sent. */
function forwardedHeaders(req) {
  const visitor = plain(req.socket.remoteAddress);
  const sent = req.headers['x-forwarded-for'];
  const chain = [sent, visitor, APPEND_SELF ? DIAL_FROM : undefined].filter(Boolean).join(', ');
  const headers = { ...req.headers, 'x-forwarded-for': chain };
  console.log(
    JSON.stringify({
      edge: 'tunnel-mimic',
      request_id: req.headers['x-request-id'] ?? null,
      host: req.headers.host ?? null,
      path: req.url,
      visitor,
      x_forwarded_for: chain,
    }),
  );
  return headers;
}

function upstream(rule) {
  const service = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(rule?.service ?? '');
  if (service) return { port: Number(service[1]) };
  const status = /^http_status:(\d{3})$/.exec(rule?.service ?? '');
  return { status: status ? Number(status[1]) : 502 };
}

const server = http.createServer((req, res) => {
  const target = upstream(match(req.headers.host, req.url));
  const headers = forwardedHeaders(req);
  if (!target.port) {
    res.writeHead(target.status).end();
    return;
  }
  const out = http.request(
    {
      host: '127.0.0.1',
      port: target.port,
      localAddress: DIAL_FROM,
      method: req.method,
      path: req.url,
      headers,
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  out.on('error', () => res.writeHead(502).end());
  req.pipe(out);
});

// WebSocket upgrades are passed through as raw sockets, as the tunnel does.
server.on('upgrade', (req, socket, head) => {
  const target = upstream(match(req.headers.host, req.url));
  const headers = forwardedHeaders(req);
  if (!target.port) {
    socket.end(`HTTP/1.1 ${target.status} Edge\r\nConnection: close\r\n\r\n`);
    return;
  }
  const out = net.connect({ host: '127.0.0.1', port: target.port, localAddress: DIAL_FROM }, () => {
    const lines = Object.entries(headers).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map((v) => `${name}: ${v}`),
    );
    out.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) out.write(head);
    out.pipe(socket);
    socket.pipe(out);
  });
  out.on('error', () => socket.destroy());
  socket.on('error', () => out.destroy());
});

server.listen(PORT, '::1', () => {
  console.error(
    `tunnel-mimic: [::1]:${PORT}, ${RULES.length} ingress rules from ${CONFIG}` +
      (APPEND_SELF ? ', appending its own address too' : ''),
  );
});
