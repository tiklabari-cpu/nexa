import { describe, expect, it } from 'vitest';
import { ERROR_STATUS, ERROR_TYPES } from './errors.js';
import { REPLY_ASSIGNMENT_REASONS, replyAssignmentRefusal } from './reply-assignment.js';

describe('reply_requires_assignment (tm 475)', () => {
  it('is a 409 of its own in the error taxonomy', () => {
    expect(ERROR_TYPES).toContain('reply_requires_assignment');
    // The request was allowed; the connection's state refused it — the same
    // answer `chat_claim_refused` and `takeover_conflict` give.
    expect(ERROR_STATUS.reply_requires_assignment).toBe(409);
  });

  it('names three reasons, in the order the rule asks', () => {
    expect(REPLY_ASSIGNMENT_REASONS).toEqual(['unassigned', 'assigned_to_other', 'ai']);
  });
});

describe('replyAssignmentRefusal', () => {
  const ME = '11111111-1111-4111-8111-111111111111';
  const COLLEAGUE = '22222222-2222-4222-8222-222222222222';

  it('lets the assignee reply, whatever the AI is doing', () => {
    for (const aiMode of [null, 'ai', 'human', 'paused']) {
      expect(replyAssignmentRefusal({ assigneeId: ME, aiMode }, ME), String(aiMode)).toBeNull();
    }
  });

  it('refuses a colleague’s connection as assigned_to_other, even beside the AI', () => {
    for (const aiMode of [null, 'ai', 'human', 'paused']) {
      expect(replyAssignmentRefusal({ assigneeId: COLLEAGUE, aiMode }, ME), String(aiMode)).toBe(
        'assigned_to_other',
      );
    }
  });

  it('refuses a connection nobody has as ai while the AI answers it or is held back', () => {
    expect(replyAssignmentRefusal({ assigneeId: null, aiMode: 'ai' }, ME)).toBe('ai');
    expect(replyAssignmentRefusal({ assigneeId: null, aiMode: 'paused' }, ME)).toBe('ai');
  });

  it('refuses any other connection nobody has as unassigned', () => {
    // Waiting in a queue (null), or handed over by the AI and still queued (human).
    expect(replyAssignmentRefusal({ assigneeId: null, aiMode: null }, ME)).toBe('unassigned');
    expect(replyAssignmentRefusal({ assigneeId: null, aiMode: 'human' }, ME)).toBe('unassigned');
  });
});
