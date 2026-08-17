/**
 * Log and telemetry masking (NFR-C4 · C4-e).
 *
 * Two properties, and they pull against each other on purpose: nothing
 * identifying survives, and everything an operator debugs with does. A test
 * suite that only asserted the first would be satisfied by returning the empty
 * string, which is why every case below also names what is still readable
 * afterwards.
 */
import { describe, expect, it } from 'vitest';
import { logSafeUrl, maskPii, requestPath } from './log-redact.js';

describe('maskPii', () => {
  it('masks an e-mail address', () => {
    expect(maskPii('customer jane.doe@example.test asked about billing')).toBe(
      'customer [redacted] asked about billing',
    );
  });

  it('masks a percent-encoded address — the form a URL carries', () => {
    // The case this exists for. A pattern that only knows `@` passes every
    // address that ever reaches a query string, which is all of them.
    expect(maskPii('/customers?query=jane%40example.test')).toBe('/customers?query=[redacted]');
  });

  it('masks the whole address, domain included', () => {
    // Keeping the domain would leave "which company" legible, and in a B2B
    // support product that is the identifying half.
    expect(maskPii('a@b.co')).not.toContain('b.co');
  });

  it('masks a card number, through the same rule the write paths use', () => {
    // Reused rather than re-implemented: `cc-mask.ts` is Luhn-gated, so this
    // inherits both the masking and the refusal to eat order numbers.
    expect(maskPii('paid with 4111 1111 1111 1111')).toBe('paid with **** **** **** 1111');
    expect(maskPii('order 1234567890123456')).toBe('order 1234567890123456');
  });

  it('leaves text with nothing identifying in it exactly as it was', () => {
    const line = 'GET /chats/abc123def456/events?page_id=xyz&limit=50';
    expect(maskPii(line)).toBe(line);
  });

  it('returns an empty string untouched', () => {
    expect(maskPii('')).toBe('');
  });
});

describe('logSafeUrl', () => {
  it('keeps the path and the harmless query, and masks the address', () => {
    expect(logSafeUrl('/api/v1/customers?query=jane%40example.test&page_id=c42&limit=25')).toBe(
      '/api/v1/customers?query=[redacted]&page_id=c42&limit=25',
    );
  });

  it('masks a named key whose value has no recognisable shape', () => {
    // The second reason the named list exists: an opaque credential matches no
    // pattern, so only the key can give it away.
    expect(logSafeUrl('/auth/callback?code=Xk93ba21&state=abc')).toBe(
      '/auth/callback?code=[redacted]&state=[redacted]',
    );
    expect(logSafeUrl('/uploads/f1?signature=deadbeefcafe')).toBe(
      '/uploads/f1?signature=[redacted]',
    );
  });

  it('does not mistake a longer key for a shorter one', () => {
    // `code_verifier` must not be matched as `code`, and its value must go.
    expect(logSafeUrl('/token?code_verifier=abc123')).toBe('/token?code_verifier=[redacted]');
  });

  it('stops at the parameter boundary', () => {
    // A greedy value would swallow everything after it and take the rest of the
    // query with it — including the ids that make the line worth keeping.
    expect(logSafeUrl('/x?token=abc&chat_id=c99&sort=asc')).toBe(
      '/x?token=[redacted]&chat_id=c99&sort=asc',
    );
  });

  it('catches an address in a key nobody named', () => {
    // The two passes exist for exactly this: the named list cannot be complete,
    // so the general pattern runs over whatever it did not cover.
    expect(logSafeUrl('/invitations?to=someone@example.test')).toBe('/invitations?to=[redacted]');
  });

  it('leaves a plain path alone', () => {
    expect(logSafeUrl('/api/v1/chats/c1234567890a')).toBe('/api/v1/chats/c1234567890a');
  });
});

describe('requestPath', () => {
  it('drops the query entirely — a span leaves the process', () => {
    // Stricter than the log, deliberately: the collector is somebody else's.
    expect(requestPath('/api/v1/customers?query=jane%40example.test')).toBe('/api/v1/customers');
  });

  it('drops a fragment too', () => {
    expect(requestPath('/kb/article#section-2')).toBe('/kb/article');
  });

  it('returns a path with no query unchanged', () => {
    expect(requestPath('/api/v1/health')).toBe('/api/v1/health');
  });

  it('returns an empty string untouched', () => {
    expect(requestPath('')).toBe('');
  });
});
