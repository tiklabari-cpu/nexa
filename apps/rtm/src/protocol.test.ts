import { describe, expect, it } from 'vitest';
import { decodeRequest, encodeError, encodePush, encodeResponse } from './protocol.js';

describe('decodeRequest', () => {
  const valid = JSON.stringify({
    version: '3.6',
    request_id: 'req-1',
    action: 'ping',
    payload: {},
  });

  it('accepts a well-formed envelope', () => {
    const result = decodeRequest(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      version: '3.6',
      request_id: 'req-1',
      action: 'ping',
      payload: {},
    });
  });

  it('defaults a missing version to the current protocol version', () => {
    const result = decodeRequest(JSON.stringify({ request_id: 'r', action: 'ping' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe('3.6');
    expect(result.value.payload).toEqual({});
  });

  it('echoes request_id on failure so the client can settle its promise', () => {
    const result = decodeRequest(JSON.stringify({ request_id: 'req-9', action: 'nope' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.requestId).toBe('req-9');
    expect(result.error.type).toBe('validation');
  });

  it('rejects unknown actions rather than passing them through', () => {
    const result = decodeRequest(JSON.stringify({ request_id: 'r', action: 'drop_database' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('drop_database');
  });

  it('rejects an unsupported protocol version', () => {
    const result = decodeRequest(
      JSON.stringify({ version: '2.0', request_id: 'r', action: 'ping' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('unsupported_version');
  });

  it('requires request_id', () => {
    const result = decodeRequest(JSON.stringify({ action: 'ping' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('request_id');
  });

  it('ignores an over-long request_id instead of echoing it back', () => {
    // Echoing unbounded client input would let a peer inflate every error frame.
    const result = decodeRequest(JSON.stringify({ request_id: 'x'.repeat(500), action: 'ping' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.requestId).toBe('-');
  });

  it.each([
    ['not json at all', 'Message is not valid JSON.'],
    ['[1,2,3]', 'Message must be a JSON object.'],
    ['"a string"', 'Message must be a JSON object.'],
    ['null', 'Message must be a JSON object.'],
  ])('rejects malformed frame %j', (raw, expected) => {
    const result = decodeRequest(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(expected);
  });

  it('rejects a non-object payload', () => {
    const result = decodeRequest(
      JSON.stringify({ request_id: 'r', action: 'ping', payload: 'oops' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('payload must be an object');
  });
});

describe('encoders', () => {
  it('marks responses with success and the originating request_id', () => {
    expect(JSON.parse(encodeResponse('r1', 'ping', { ok: 1 }))).toEqual({
      request_id: 'r1',
      action: 'ping',
      type: 'response',
      success: true,
      payload: { ok: 1 },
    });
  });

  it('wraps errors in the same envelope as REST (ADR-06)', () => {
    const frame = JSON.parse(
      encodeError('r2', 'send_event', { type: 'chat_inactive', message: 'nope' }),
    );
    expect(frame.success).toBe(false);
    expect(frame.payload.error).toEqual({
      type: 'chat_inactive',
      message: 'nope',
      request_id: 'r2',
    });
  });

  it('emits pushes without a request_id', () => {
    const frame = JSON.parse(encodePush('incoming_event', { chat_id: 'X' }));
    expect(frame).toEqual({ action: 'incoming_event', type: 'push', payload: { chat_id: 'X' } });
    expect(frame.request_id).toBeUndefined();
  });
});
