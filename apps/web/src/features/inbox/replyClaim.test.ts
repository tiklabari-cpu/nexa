/**
 * What the strip above the composer offers (tm 475.4): the server's reply rule
 * (`replyAssignmentRefusal`) and its claim rule (`ChatService.claim`), asked of
 * the chat read. The server decides; this decides what is drawn.
 */
import { describe, expect, it } from 'vitest';
import { replyClaim } from './replyClaim.js';
import type { ChatDetail } from './types.js';

type Thread = NonNullable<ChatDetail['thread']>;

function chat(thread: Partial<Thread> | null, groupIds: number[] = [7]) {
  return {
    access: { group_ids: groupIds },
    thread:
      thread === null
        ? null
        : {
            id: 'T1',
            chat_id: 'C1',
            active: true,
            assignee_id: null,
            queue_position: null,
            summary: null,
            created_at: '2026-11-07T10:00:00Z',
            closed_at: null,
            ai_mode: null,
            tags: [],
            ...thread,
          },
  };
}

const MEMBER = { memberOf: new Set([7]), canTakeOver: false };
const NOT_MEMBER = { memberOf: new Set<number>(), canTakeOver: false };

describe('replyClaim', () => {
  it('draws nothing when the connection is mine, even beside the AI', () => {
    expect(replyClaim(chat({ assignee_id: 'me' }), 'me', NOT_MEMBER)).toEqual({ kind: 'mine' });
    expect(replyClaim(chat({ assignee_id: 'me', ai_mode: 'ai' }), 'me', NOT_MEMBER)).toEqual({
      kind: 'mine',
    });
  });

  it('names the colleague, and offers Take over only to whoever may', () => {
    expect(replyClaim(chat({ assignee_id: 'sam' }), 'me', NOT_MEMBER)).toEqual({
      kind: 'other',
      assigneeId: 'sam',
      canTakeOver: false,
    });
    expect(
      replyClaim(chat({ assignee_id: 'sam' }), 'me', { ...NOT_MEMBER, canTakeOver: true }),
    ).toEqual({ kind: 'other', assigneeId: 'sam', canTakeOver: true });
  });

  it('offers Take on a queued chat to a member of its team only', () => {
    const queued = chat({ queue_position: 2 });
    expect(replyClaim(queued, 'me', MEMBER)).toEqual({ kind: 'claim' });
    expect(replyClaim(queued, 'me', NOT_MEMBER)).toEqual({ kind: 'waiting' });
  });

  it('takes a queued chat under the queue rule even while the AI answers beside it', () => {
    expect(replyClaim(chat({ queue_position: 1, ai_mode: 'ai' }), 'me', NOT_MEMBER)).toEqual({
      kind: 'waiting',
    });
  });

  it("offers Take on the AI's chat — answering or held back — to anyone who sees it", () => {
    expect(replyClaim(chat({ ai_mode: 'ai' }), 'me', NOT_MEMBER)).toEqual({ kind: 'claim' });
    expect(replyClaim(chat({ ai_mode: 'paused' }), 'me', NOT_MEMBER)).toEqual({ kind: 'claim' });
  });

  it('offers nothing to take on a chat nobody routed', () => {
    expect(replyClaim(chat({}), 'me', MEMBER)).toEqual({ kind: 'waiting' });
    expect(replyClaim(chat({ ai_mode: 'human' }), 'me', MEMBER)).toEqual({ kind: 'waiting' });
  });

  it('gates nothing without a connection or a signed-in agent', () => {
    expect(replyClaim(chat(null), 'me', MEMBER)).toEqual({ kind: 'mine' });
    expect(replyClaim(chat({ assignee_id: 'sam' }), null, MEMBER)).toEqual({ kind: 'mine' });
  });
});
