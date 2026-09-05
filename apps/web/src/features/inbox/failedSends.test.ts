/**
 * The holding place for a refused send (FR-MOD-02.3.3 · FR-MOD-02.3.6).
 *
 * Three properties carry the feature, and all three are arithmetic the screen
 * cannot show on its own: a failure is identified by its idempotency key rather
 * than its position, a retry that fails again updates that one entry instead of
 * growing a second row for one message, and the transient/permanent split comes
 * from the client error taxonomy rather than a second opinion written here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useFailedSendStore, type FailedSend } from './failedSends.js';
import { ApiClientError } from '../../lib/api-client.js';
import type { SendInput } from './types.js';

const CHAT = 'TJ1H8CFKRV';

function input(overrides: Partial<SendInput> = {}): SendInput {
  return { text: 'Bring it in tomorrow', recipients: 'all', idempotencyKey: 'key-1', ...overrides };
}

function held(chatId = CHAT): readonly FailedSend[] {
  return useFailedSendStore.getState().byChat[chatId] ?? [];
}

beforeEach(() => {
  useFailedSendStore.setState({ byChat: {} });
});

describe('failed sends (FR-MOD-02.3.3 · FR-MOD-02.3.6)', () => {
  it('holds a refused message with everything a retry needs', () => {
    const error = new ApiClientError({
      type: 'service_unavailable',
      status: 503,
      message: 'Temporarily unavailable.',
      requestId: 'req-1',
    });
    useFailedSendStore
      .getState()
      .record(CHAT, input({ attachmentUrl: 'https://cdn.test/photo.png' }), error);

    expect(held()).toHaveLength(1);
    // The whole input, unchanged — including the attachment, which is already
    // uploaded, so the retry re-sends the same URL rather than dropping the file.
    expect(held()[0]?.input).toEqual({
      text: 'Bring it in tomorrow',
      recipients: 'all',
      attachmentUrl: 'https://cdn.test/photo.png',
      idempotencyKey: 'key-1',
    });
    expect(held()[0]?.retryable).toBe(true);
    expect(held()[0]?.errorKey).toBe('common.errors.service_unavailable');
  });

  it('marks a refusal we caused as not worth retrying', () => {
    useFailedSendStore.getState().record(
      CHAT,
      input(),
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'Only the assignee can reply here.',
        requestId: 'req-2',
      }),
    );

    // A Retry whose outcome is a certain second 403 is a trap, so the row that
    // reads this flag offers the reason instead of a button.
    expect(held()[0]?.retryable).toBe(false);
    expect(held()[0]?.errorKey).toBe('common.errors.authorization');
  });

  it('treats a thrown non-API value as unknown rather than retryable', () => {
    useFailedSendStore.getState().record(CHAT, input(), new TypeError('boom'));
    expect(held()[0]?.retryable).toBe(false);
    expect(held()[0]?.errorKey).toBe('common.errors.unknown');
  });

  it('updates the same message in place when a retry fails again', () => {
    const store = useFailedSendStore.getState();
    store.record(
      CHAT,
      input(),
      new ApiClientError({ type: 'network', status: 0, message: 'x', requestId: '-' }),
    );
    store.record(CHAT, input({ text: 'later text is ignored' }), new TypeError('boom'));

    // One message, one row — the retry did not append a duplicate — and the row
    // now carries the newest verdict.
    expect(held()).toHaveLength(1);
    expect(held()[0]?.retryable).toBe(false);
  });

  it('keeps a second failed message as its own row, in attempt order', () => {
    const store = useFailedSendStore.getState();
    const boom = new TypeError('boom');
    store.record(CHAT, input({ text: 'first', idempotencyKey: 'key-1' }), boom);
    store.record(CHAT, input({ text: 'second', idempotencyKey: 'key-2' }), boom);

    expect(held().map((entry) => entry.input.text)).toEqual(['first', 'second']);
  });

  it('clears only the message that went through, and drops the chat when empty', () => {
    const store = useFailedSendStore.getState();
    const boom = new TypeError('boom');
    store.record(CHAT, input({ idempotencyKey: 'key-1' }), boom);
    store.record(CHAT, input({ idempotencyKey: 'key-2' }), boom);

    useFailedSendStore.getState().clear(CHAT, 'key-1');
    expect(held().map((entry) => entry.input.idempotencyKey)).toEqual(['key-2']);

    useFailedSendStore.getState().clear(CHAT, 'key-2');
    expect(useFailedSendStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('keeps one conversation’s failures out of another', () => {
    const boom = new TypeError('boom');
    useFailedSendStore.getState().record(CHAT, input(), boom);
    useFailedSendStore.getState().record('OTHERCHAT', input(), boom);

    useFailedSendStore.getState().clear(CHAT, 'key-1');
    expect(held('OTHERCHAT')).toHaveLength(1);
  });
});
