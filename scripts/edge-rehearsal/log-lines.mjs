/**
 * Reading the logs the edge rehearsal measures (tm 410). Split out of probe.mjs
 * so `log-lines.test.mjs` can import it without sending a request.
 */
import { readFileSync } from 'node:fs';

/**
 * The key the api writes the request id under — `LOG_KEYS.requestId`
 * (`packages/types/src/log-keys.ts`), set on Fastify as `requestIdLogLabel`
 * since tm 288.1. `log-lines.test.mjs` pins this string to both of those.
 */
export const API_REQUEST_ID_FIELD = 'request_id';

/** The key pino used before tm 288.1; still accepted so an older api log reads. */
export const LEGACY_REQUEST_ID_FIELD = 'reqId';

/** Every JSON line of a log; anything else (a banner, pretty output) is skipped. */
export function jsonLines(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return parseJsonLines(text);
}

export function parseJsonLines(text) {
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
export function apiSaw(lines, id) {
  return lines.find(
    (entry) =>
      (entry[API_REQUEST_ID_FIELD] ?? entry[LEGACY_REQUEST_ID_FIELD]) === id &&
      entry.req?.remoteAddress,
  )?.req.remoteAddress;
}

/** The visitor the edge saw for one request id — the mimic's record or Caddy's access log. */
export function edgeSaw(lines, id) {
  for (const entry of lines) {
    if (entry.request_id === id && entry.visitor) return entry.visitor;
    const header = entry.request?.headers?.['X-Request-Id']?.[0];
    if (header === id && entry.request?.remote_ip) return entry.request.remote_ip;
  }
  return undefined;
}
