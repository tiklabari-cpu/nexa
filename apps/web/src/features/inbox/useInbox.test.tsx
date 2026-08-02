/**
 * The realtime push → store wiring for the multi-agent conflict warning
 * (FR-MOD-08.6.3). `applyPush` is exported from `useInbox.ts` for exactly this
 * — there is no other way to reach a push handler without standing up a real
 * socket.
 */
import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPush } from './useInbox.js';
import { useConflictStore } from './conflict.js';
import { ConflictBanner } from './ConflictBanner.js';

const CHAT = 'TJ1H8CFKRV';

const TWO_AGENTS_PAYLOAD = {
  chat_id: CHAT,
  thread_id: 'thread-1',
  agents: [
    { agent_id: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
    { agent_id: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
  ],
  detected_at: '2026-08-02T10:00:01.000Z',
};

describe('applyPush — agent_conflict_warning', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useConflictStore.getState().clear(CHAT);
    useConflictStore.setState({ byChat: {} });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('folds a conflict warning into the store', () => {
    applyPush(queryClient, 'agent_conflict_warning', TWO_AGENTS_PAYLOAD);
    expect(useConflictStore.getState().byChat[CHAT]).toEqual({
      agents: [
        { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
        { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
      ],
      detectedAt: '2026-08-02T10:00:01.000Z',
    });
  });

  it('the warning appears on screen — push → store → banner, the full chain', () => {
    applyPush(queryClient, 'agent_conflict_warning', TWO_AGENTS_PAYLOAD);
    render(<ConflictBanner chatId={CHAT} />);
    const banner = screen.getByTestId('conflict-banner');
    expect(banner).toHaveTextContent('agent-1');
    expect(banner).toHaveTextContent('agent-2');
  });

  it('ignores a payload with no chat_id', () => {
    const { chat_id: _chatId, ...rest } = TWO_AGENTS_PAYLOAD;
    applyPush(queryClient, 'agent_conflict_warning', rest);
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('ignores a payload whose agents is not an array', () => {
    applyPush(queryClient, 'agent_conflict_warning', { ...TWO_AGENTS_PAYLOAD, agents: 'nope' });
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('ignores a payload with a malformed agent entry', () => {
    applyPush(queryClient, 'agent_conflict_warning', {
      ...TWO_AGENTS_PAYLOAD,
      agents: [{ agent_id: 'agent-1', since: '2026-08-02T10:00:00.000Z' }, { since: 'no id' }],
    });
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('does not throw on a push with no payload fields at all', () => {
    expect(() => applyPush(queryClient, 'agent_conflict_warning', {})).not.toThrow();
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });
});

describe('applyPush — chat_deactivated clears a live conflict', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useConflictStore.getState().clear(CHAT);
    useConflictStore.setState({ byChat: {} });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('a closed chat cannot stay "conflicting"', () => {
    applyPush(queryClient, 'agent_conflict_warning', TWO_AGENTS_PAYLOAD);
    expect(useConflictStore.getState().byChat[CHAT]).toBeDefined();

    applyPush(queryClient, 'chat_deactivated', { chat_id: CHAT });
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });
});
