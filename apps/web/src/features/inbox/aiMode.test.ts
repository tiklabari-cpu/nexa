/**
 * Which AI badge the transcript header shows, and what the caller may do about
 * it (AI-11 · tm 293.5) — `aiMode.ts`, apart from the header that draws it.
 */
import { describe, expect, it } from 'vitest';
import { aiModeActions, aiModeBadge, withAiModeChange } from './aiMode.js';
import type { ChatDetail } from './types.js';

type ThreadOverrides = Partial<NonNullable<ChatDetail['thread']>>;

function chat(overrides: ThreadOverrides = {}, active = true): ChatDetail {
  return {
    id: 'TJ1H8CFKRV',
    license_id: '1000003',
    customer_id: 'cust-1',
    active,
    created_at: '2026-10-17T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: 'TJ1H8CFKRV',
      active,
      assignee_id: null,
      queue_position: null,
      summary: null,
      created_at: '2026-10-17T10:00:00.000Z',
      closed_at: null,
      tags: [],
      ...overrides,
    },
  };
}

describe('aiModeBadge', () => {
  it('shows the AI answering and the AI held back', () => {
    expect(aiModeBadge(chat({ ai_mode: 'ai' }))).toBe('ai');
    expect(aiModeBadge(chat({ ai_mode: 'paused' }))).toBe('paused');
  });

  it('shows "with a person" only where the AI answered before', () => {
    expect(aiModeBadge(chat({ ai_mode: 'human', ai_took_part: true }))).toBe('human');
    // A person answered from the start — every chat of a workspace with no AI agent.
    expect(aiModeBadge(chat({ ai_mode: 'human', ai_took_part: false }))).toBeNull();
    expect(aiModeBadge(chat({ ai_mode: 'human' }))).toBeNull();
  });

  it('shows nothing before anyone took part, on a closed chat, or from a server that predates the mode', () => {
    expect(aiModeBadge(chat({ ai_mode: null }))).toBeNull();
    expect(aiModeBadge(chat({ ai_mode: 'ai' }, false))).toBeNull();
    expect(aiModeBadge(chat())).toBeNull();
    expect(aiModeBadge({ ...chat(), thread: null })).toBeNull();
  });
});

describe('aiModeActions — the routes’ own rules', () => {
  const agent = { isAssignee: true, isSupervisor: false };
  const supervisor = { isAssignee: false, isSupervisor: true };
  const teammate = { isAssignee: false, isSupervisor: false };

  it('lets the assignee hold the AI back or give the chat back', () => {
    expect(aiModeActions('ai', agent)).toEqual({ pause: true, giveBack: false });
    expect(aiModeActions('human', agent)).toEqual({ pause: false, giveBack: true });
    expect(aiModeActions('paused', agent)).toEqual({ pause: false, giveBack: true });
  });

  it('lets an admin or owner do the same on anyone’s chat', () => {
    expect(aiModeActions('ai', supervisor)).toEqual({ pause: true, giveBack: false });
    expect(aiModeActions('paused', supervisor)).toEqual({ pause: false, giveBack: true });
    expect(aiModeActions('human', supervisor)).toEqual({ pause: false, giveBack: true });
  });

  it('offers a teammate who holds neither nothing — a colleague’s chat is not theirs to give back', () => {
    for (const badge of ['ai', 'human', 'paused'] as const) {
      expect(aiModeActions(badge, teammate)).toEqual({ pause: false, giveBack: false });
    }
    expect(aiModeActions(null, supervisor)).toEqual({ pause: false, giveBack: false });
  });
});

describe('withAiModeChange — the push folded into the cached chat', () => {
  const push = (over: Record<string, unknown> = {}) => ({
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'TH1',
    ai_mode: 'human',
    previous_ai_mode: 'ai',
    by: 'agent-1',
    reason: 'agent_message',
    ...over,
  });

  it('moves the named connection’s mode', () => {
    const next = withAiModeChange(chat({ ai_mode: 'ai', ai_took_part: true }), push());
    expect(next?.thread).toMatchObject({ ai_mode: 'human', ai_took_part: true });
  });

  it('takes the AI’s own first turn as the proof it took part', () => {
    const next = withAiModeChange(
      chat({ ai_mode: null, ai_took_part: false }),
      push({ ai_mode: 'ai', previous_ai_mode: null, by: 'ai-agent', reason: null }),
    );
    expect(next?.thread).toMatchObject({ ai_mode: 'ai', ai_took_part: true });
    // A hand-back to an AI that never spoke is not.
    const given = withAiModeChange(
      chat({ ai_mode: 'human', ai_took_part: false }),
      push({ ai_mode: 'ai', previous_ai_mode: 'human', reason: 'return_to_ai' }),
    );
    expect(given?.thread).toMatchObject({ ai_mode: 'ai', ai_took_part: false });
  });

  it('leaves the chat alone for another connection, an unknown mode or nothing cached', () => {
    const cached = chat({ ai_mode: 'ai' });
    expect(withAiModeChange(cached, push({ thread_id: 'OLDER' }))).toBe(cached);
    expect(withAiModeChange(cached, push({ ai_mode: 'bot' }))).toBe(cached);
    expect(withAiModeChange(undefined, push())).toBeUndefined();
  });
});
