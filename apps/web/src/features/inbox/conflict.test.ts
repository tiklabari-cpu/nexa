/**
 * The conflict store folds `agent_conflict_warning` pushes into a live view
 * per chat and lets a lapsed warning clear itself — a warning that never
 * clears leaves an agent staring at a stale "someone else is writing" banner
 * long after the other agent stopped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFLICT_IDLE_MS, useConflictStore } from './conflict.js';

const CHAT = 'TJ1H8CFKRV';

describe('useConflictStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConflictStore.getState().clear(CHAT);
    useConflictStore.setState({ byChat: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a conflict with the composing agents', () => {
    useConflictStore.getState().note(
      CHAT,
      [
        { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
        { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
      ],
      '2026-08-02T10:00:01.000Z',
    );
    expect(useConflictStore.getState().byChat[CHAT]).toEqual({
      agents: [
        { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
        { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
      ],
      detectedAt: '2026-08-02T10:00:01.000Z',
    });
  });

  it('ignores a payload with fewer than two agents', () => {
    useConflictStore
      .getState()
      .note(
        CHAT,
        [{ agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' }],
        '2026-08-02T10:00:00.000Z',
      );
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('clears the conflict directly', () => {
    useConflictStore.getState().note(
      CHAT,
      [
        { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
        { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
      ],
      '2026-08-02T10:00:01.000Z',
    );
    useConflictStore.getState().clear(CHAT);
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('lapses on its own if no fresh warning refreshes it', () => {
    useConflictStore.getState().note(
      CHAT,
      [
        { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
        { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
      ],
      '2026-08-02T10:00:01.000Z',
    );
    expect(useConflictStore.getState().byChat[CHAT]).toBeDefined();

    vi.advanceTimersByTime(CONFLICT_IDLE_MS + 1);
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('a fresh warning pushes the lapse back', () => {
    const agents = [
      { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
      { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
    ];
    useConflictStore.getState().note(CHAT, agents, '2026-08-02T10:00:01.000Z');
    vi.advanceTimersByTime(CONFLICT_IDLE_MS - 100);
    useConflictStore.getState().note(CHAT, agents, '2026-08-02T10:00:07.000Z');
    vi.advanceTimersByTime(200); // past the first deadline, before the new one
    expect(useConflictStore.getState().byChat[CHAT]).toBeDefined();
  });
});
