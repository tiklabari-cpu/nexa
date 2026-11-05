// node --test scripts/edge-rehearsal/log-lines.test.mjs — kapıda `statik › loop-tools` adımı.
// tm 410: prova betiği api log'unda request id'yi yanlış alanda arıyordu ve her probu FAIL yazıyordu.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  API_REQUEST_ID_FIELD,
  LEGACY_REQUEST_ID_FIELD,
  apiSaw,
  edgeSaw,
  parseJsonLines,
} from './log-lines.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

describe('apiSaw', () => {
  test('request_id taşıyan "incoming request" satırı eşleşir', () => {
    const lines = [
      { request_id: 'p-api', msg: 'incoming request', req: { remoteAddress: '198.51.100.9' } },
    ];
    assert.equal(apiSaw(lines, 'p-api'), '198.51.100.9');
  });

  test('eski reqId alanı da eşleşir', () => {
    const lines = [{ reqId: 'p-old', req: { remoteAddress: '::1' } }];
    assert.equal(apiSaw(lines, 'p-old'), '::1');
  });

  test('negatif: başka id, adressiz satır ya da hiç satır → undefined', () => {
    const lines = [
      { request_id: 'other', req: { remoteAddress: '198.51.100.9' } },
      { request_id: 'p-api', msg: 'request completed' },
    ];
    assert.equal(apiSaw(lines, 'p-api'), undefined);
    assert.equal(apiSaw([], 'p-api'), undefined);
  });

  test('adresli satır adressizden sonra gelse de bulunur', () => {
    const lines = [
      { request_id: 'p-api', msg: 'request completed' },
      { request_id: 'p-api', msg: 'incoming request', req: { remoteAddress: '203.0.113.5' } },
    ];
    assert.equal(apiSaw(lines, 'p-api'), '203.0.113.5');
  });
});

describe('parseJsonLines + edgeSaw', () => {
  test('JSON olmayan satır atlanır, önündeki ek metin kesilir', () => {
    const lines = parseJsonLines(
      'banner\n2026-11-05T00:00:00Z {"request_id":"x","req":{"remoteAddress":"1.2.3.4"}}\n{bozuk\n',
    );
    assert.equal(lines.length, 1);
    assert.equal(apiSaw(lines, 'x'), '1.2.3.4');
  });

  test('tünel taklidi ve Caddy erişim günlüğü okunur', () => {
    assert.equal(edgeSaw([{ request_id: 'a', visitor: '::1' }], 'a'), '::1');
    const caddy = {
      request: { headers: { 'X-Request-Id': ['b'] }, remote_ip: '10.0.0.7' },
    };
    assert.equal(edgeSaw([caddy], 'b'), '10.0.0.7');
    assert.equal(edgeSaw([caddy], 'c'), undefined);
  });
});

describe('alan adı api ile aynı yazılır', () => {
  test('betiğin alanı LOG_KEYS.requestId ile aynı', () => {
    assert.match(
      read('packages/types/src/log-keys.ts'),
      new RegExp(`requestId:\\s*'${API_REQUEST_ID_FIELD}'`),
    );
  });

  test("api Fastify'a request id'yi LOG_KEYS.requestId altında yazdırır", () => {
    assert.match(
      read('apps/api/src/lib/fastify-options.ts'),
      /requestIdLogLabel:\s*LOG_KEYS\.requestId/,
    );
  });

  test('eski ad yeni addan farklı kalır (iki yol da denenir)', () => {
    assert.notEqual(API_REQUEST_ID_FIELD, LEGACY_REQUEST_ID_FIELD);
  });

  test('probe.mjs alan adını kendisi yazmaz, modülden okur', () => {
    const probe = read('scripts/edge-rehearsal/probe.mjs');
    assert.doesNotMatch(probe, /\.reqId\b/);
    assert.match(probe, /from '\.\/log-lines\.mjs'/);
  });
});
