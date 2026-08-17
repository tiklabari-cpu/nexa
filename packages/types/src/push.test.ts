import { describe, expect, it } from 'vitest';

import { isPushEventKind, PUSH_EVENT_KINDS, readPushPayload } from './push.js';

describe('isPushEventKind', () => {
  it('accepts the three kinds the sender writes', () => {
    // The same list `renderPush` switches on; a fourth added on the server
    // without adding it here is a notification the phone will not route.
    expect(PUSH_EVENT_KINDS).toEqual(['new_chat', 'assignment', 'message']);
    for (const kind of PUSH_EVENT_KINDS) expect(isPushEventKind(kind)).toBe(true);
  });

  it('rejects anything else, including near misses', () => {
    for (const bad of ['Message', 'new-chat', '', null, undefined, 3, {}]) {
      expect(isPushEventKind(bad), String(bad)).toBe(false);
    }
  });
});

describe('readPushPayload', () => {
  it('reads the shape the push provider writes', () => {
    expect(readPushPayload({ kind: 'message', chat_id: 'chat-1' })).toEqual({
      kind: 'message',
      chat_id: 'chat-1',
    });
  });

  it('ignores extra fields rather than refusing the payload', () => {
    // A server one deploy ahead may add a field; the two this build needs are
    // both here, so the notification is still routable.
    expect(readPushPayload({ kind: 'assignment', chat_id: 'chat-2', thread_id: 'T1' })).toEqual({
      kind: 'assignment',
      chat_id: 'chat-2',
    });
  });

  it('refuses a payload with no destination', () => {
    // The whole point of the payload is which conversation to open. Defaulting
    // or guessing would open somebody else's.
    expect(readPushPayload({ kind: 'message' })).toBeNull();
    expect(readPushPayload({ kind: 'message', chat_id: '' })).toBeNull();
    expect(readPushPayload({ kind: 'message', chat_id: 42 })).toBeNull();
  });

  it('refuses a kind this build does not know', () => {
    expect(readPushPayload({ kind: 'mention', chat_id: 'chat-1' })).toBeNull();
    expect(readPushPayload({ chat_id: 'chat-1' })).toBeNull();
  });

  it('refuses anything that is not an object', () => {
    for (const bad of [null, undefined, 'chat-1', 7, []]) {
      expect(readPushPayload(bad), String(bad)).toBeNull();
    }
  });
});
