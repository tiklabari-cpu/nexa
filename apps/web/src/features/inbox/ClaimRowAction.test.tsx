/**
 * A Queued-view row's "Take" (WG-07 · tm 346): it takes the conversation and
 * opens it; a refusal says why — someone else took it, or the agent is at
 * their limit — and the list re-reads either way. Which rows offer it is
 * `claimableTeamIds`: a manual team the agent is a member of.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { claimableTeamIds } from './transfer.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { ClaimRowAction } = await import('./ClaimRowAction.js');

function refusal(reason: string): ApiClientError {
  return new ApiClientError({
    type: 'chat_claim_refused',
    status: 409,
    message: 'refused',
    requestId: 'r1',
    details: { reason },
  });
}

function renderAction(onOpen = vi.fn()): { onOpen: typeof onOpen; client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ClaimRowAction chatId="chat-1" customerName="Ayşe" onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { onOpen, client };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('ClaimRowAction', () => {
  it('takes the conversation and opens it', async () => {
    api.post.mockResolvedValue({ id: 'chat-1' });
    const { onOpen, client } = renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Take Ayşe' }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('chat-1'));
    expect(api.post).toHaveBeenCalledWith('/chats/chat-1/claim');
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chats'] });
  });

  it('says another agent took it first, and re-reads the list', async () => {
    api.post.mockRejectedValue(refusal('claimed'));
    const { onOpen, client } = renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Take Ayşe' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else took this chat first.',
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chats'] });
  });

  it('says the agent is at their limit', async () => {
    api.post.mockRejectedValue(refusal('limit'));
    renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Take Ayşe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at your chat limit/);
  });
});

describe('claimableTeamIds', () => {
  it('offers a manual team the agent is a member of, and no other', () => {
    const teams = [
      { id: 1, name: 'Bonus', assignment_mode: 'manual', agents: [{ agent_id: 'me' }] },
      { id: 2, name: 'VIP', assignment_mode: 'manual', agents: [{ agent_id: 'other' }] },
      { id: 3, name: 'Support', assignment_mode: 'auto', agents: [{ agent_id: 'me' }] },
      { id: 4, name: 'Old server', agents: [{ agent_id: 'me' }] },
    ];
    expect([...claimableTeamIds(teams, 'me')]).toEqual([1]);
    expect(claimableTeamIds(teams, null).size).toBe(0);
  });
});
