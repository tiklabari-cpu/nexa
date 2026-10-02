#!/usr/bin/env node
/**
 * The edge rehearsal's measurement (tm 257.10). See README.md next to this file.
 *
 *   node scripts/edge-rehearsal/probe.mjs <edge base URL> <api log> <edge log>
 *
 * Sends two requests through the edge, both carrying a forged
 * `X-Forwarded-For: 203.0.113.77` and their own `X-Request-Id`: one on the
 * api's name and one on the panel's `/api/` path. Then it reads, for each
 * request id, the address the edge saw (the edge log) and the address the api
 * derived (`req.remoteAddress` on the api's "incoming request" line — Fastify
 * writes `request.ip` there), and compares them.
 *
 * PASS: the api derived exactly the address the edge saw. Anything else is a
 * FAIL with the reading that explains it. Exit code 0 only if both pass.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const [edgeBase, apiLog, edgeLog] = process.argv.slice(2);
if (!edgeBase || !apiLog || !edgeLog) {
  console.error('usage: probe.mjs <edge base URL> <api log> <edge log>');
  process.exit(2);
}

const SPOOF = '203.0.113.77';
const run = `edge-probe-${Date.now().toString(36)}`;
const PROBES = [
  { name: 'api name', host: 'api.example.com', id: `${run}-api` },
  { name: 'panel /api/', host: 'panel.example.com', id: `${run}-panel` },
];

function send(probe) {
  const edge = new URL(edgeBase);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: edge.hostname.replace(/^\[|\]$/g, ''),
        port: edge.port || 80,
        path: '/api/v1/health/live',
        headers: { host: probe.host, 'x-forwarded-for': SPOOF, 'x-request-id': probe.id },
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve(`error: ${error.message}`));
    req.end();
  });
}

/** Every JSON line of a log; anything else (a banner, pretty output) is skipped. */
function jsonLines(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    const start = line.indexOf('{');
    if (start < 0) return [];
    try {
      return [JSON.parse(line.slice(start))];
    } catch {
      return [];
    }
  });
}

/** The address the api derived for one request id. */
function apiSaw(lines, id) {
  return lines.find((entry) => entry.reqId === id && entry.req?.remoteAddress)?.req.remoteAddress;
}

/** The visitor the edge saw for one request id — the mimic's record or Caddy's access log. */
function edgeSaw(lines, id) {
  for (const entry of lines) {
    if (entry.request_id === id && entry.visitor) return entry.visitor;
    const header = entry.request?.headers?.['X-Request-Id']?.[0];
    if (header === id && entry.request?.remote_ip) return entry.request.remote_ip;
  }
  return undefined;
}

const plain = (address) => (address ?? '').replace(/^::ffff:/, '');

function verdict(api, edge) {
  if (!api) {
    return 'FAIL — no "incoming request" line with this reqId in the api log (request logging off, LOG_LEVEL above info, or req.remoteAddress redacted)';
  }
  if (plain(api) === SPOOF) {
    return 'FAIL — the api believed the forged entry: TRUST_PROXY_HOPS is higher than the hops on this path, or the request reached the api without crossing the edge';
  }
  if (!edge) return 'FAIL — the edge has no record of this request';
  if (plain(api) !== plain(edge)) {
    return `FAIL — the api derived ${api}, not the visitor the edge saw: TRUST_PROXY_HOPS is lower than the hops on this path (the edge or a second proxy appended an entry of its own)`;
  }
  return 'PASS';
}

const statuses = [];
for (const probe of PROBES) statuses.push(await send(probe));
await sleep(1000);

const apiLines = jsonLines(apiLog);
const edgeLines = jsonLines(edgeLog);
let failed = 0;
console.log(`edge ${edgeBase} · forged X-Forwarded-For ${SPOOF}`);
PROBES.forEach((probe, i) => {
  const api = apiSaw(apiLines, probe.id);
  const edge = edgeSaw(edgeLines, probe.id);
  const result = verdict(api, edge);
  if (result !== 'PASS') failed += 1;
  console.log(
    `  ${probe.name.padEnd(12)} ${probe.id}  HTTP ${statuses[i]}  edge saw ${edge ?? '-'}  api derived ${api ?? '-'}  ${result}`,
  );
});
process.exit(failed === 0 ? 0 : 1);
