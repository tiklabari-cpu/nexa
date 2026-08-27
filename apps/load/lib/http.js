/**
 * Every HTTP call this suite makes goes through here.
 *
 * One reason: the `op` tag and the `nexa_measured{op:…}` counter have to agree,
 * always. The tag decides which latency budget the request lands in; the
 * counter is the proof that the budget was driven at all (`thresholds.js` →
 * `exercised`). Set by two separate call sites they would eventually disagree,
 * and the failure is silent in the direction that matters — a budget with a
 * tagged sample but no counter reads as unexercised, a budget with a counter
 * but no tagged sample reads as met.
 *
 * So neither is a scenario's job. A scenario says what kind of call it is
 * making, once, and both follow.
 */
import http from 'k6/http';
import { observe } from './metrics.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Merge caller params with the `op` tag, without dropping caller tags. */
function tagged(op, params) {
  return { ...params, tags: { ...params.tags, op } };
}

/**
 * @param {string} url
 * @param {string} op one of `OP_TAGS`
 * @param {object} [params] k6 request params (headers, timeout, …)
 */
export function get(url, op, params = {}) {
  return observe(http.get(url, tagged(op, params)), op);
}

/**
 * @param {string} url
 * @param {unknown} body serialised as JSON
 * @param {string} op one of `OP_TAGS`
 * @param {object} [params] k6 request params
 */
export function postJson(url, body, op, params = {}) {
  const withHeaders = { ...params, headers: { ...JSON_HEADERS, ...params.headers } };
  return observe(http.post(url, JSON.stringify(body), tagged(op, withHeaders)), op);
}
