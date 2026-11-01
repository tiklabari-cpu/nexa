/**
 * The cleaning every delivery error goes through before it is stored or shown
 * (KN-03 · tm 375): no secret, token, URL or long body, one line, at most 500.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_ERROR_MAX_LENGTH, sanitizeDeliveryError } from './delivery-error.js';

describe('sanitizeDeliveryError', () => {
  it('passes the codes the sender writes through unchanged', () => {
    for (const code of [
      'http_503',
      'ssrf_blocked',
      'ECONNREFUSED',
      'AbortError',
      'url_check_failed',
    ]) {
      expect(sanitizeDeliveryError(code)).toBe(code);
    }
  });

  it('keeps null and empty as null', () => {
    expect(sanitizeDeliveryError(null)).toBeNull();
    expect(sanitizeDeliveryError(undefined)).toBeNull();
    expect(sanitizeDeliveryError('  \n\t ')).toBeNull();
  });

  it('removes a signing secret, bearer tokens, key=value credentials and URLs', () => {
    const cleaned = sanitizeDeliveryError(
      'failed: whsec_AbCdEf0123 Bearer eyJhbGciOi.payload.sig ' +
        'Authorization: Basic dXNlcjpwYXNz api_key=sk-live-1234 ' +
        'GET https://hooks.example.com/path?token=abc123 ECONNRESET',
    );
    expect(cleaned).not.toBeNull();
    for (const leaked of [
      'whsec_AbCdEf0123',
      'eyJhbGciOi',
      'dXNlcjpwYXNz',
      'sk-live-1234',
      'hooks.example.com',
      'abc123',
    ]) {
      expect(cleaned).not.toContain(leaked);
    }
    // What is useful survives.
    expect(cleaned).toContain('ECONNRESET');
  });

  it('removes a long opaque run (a hex or base64 token) wherever it sits', () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';
    expect(sanitizeDeliveryError(`bad header ${token} rejected`)).toBe(
      'bad header [redacted] rejected',
    );
  });

  it('flattens control characters and newlines to one line', () => {
    expect(sanitizeDeliveryError('line one\r\nline two\u0000\u001b[31m')).toBe(
      'line one line two [31m',
    );
  });

  it('cuts a long body at the limit, with an ellipsis', () => {
    const cleaned = sanitizeDeliveryError(`${'word '.repeat(400)}`) ?? '';
    expect(cleaned.length).toBe(DELIVERY_ERROR_MAX_LENGTH);
    expect(cleaned.endsWith('…')).toBe(true);
    // A text exactly at the limit is not cut.
    const exact = 'x '.repeat(DELIVERY_ERROR_MAX_LENGTH / 2 - 1) + 'x';
    expect(sanitizeDeliveryError(exact)).toBe(exact);
  });
});
