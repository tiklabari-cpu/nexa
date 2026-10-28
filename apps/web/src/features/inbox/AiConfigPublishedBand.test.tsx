/**
 * The Inbox band for `ai_config_published` (tm 316.4 · AI-20): the push
 * names the live version, a rollback says so, the Playbook's version queries
 * are read again, an older replay or a malformed payload changes nothing, and
 * a dismiss hides the band.
 */
import { QueryClient } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAiConfigNotice } from '../../lib/ai-config-notice.js';
import { useAuth } from '../../lib/auth-store.js';
import { AiConfigPublishedBand } from './AiConfigPublishedBand.js';
import { applyPush } from './useInbox.js';

const PUSH = {
  ai_agent_id: 'b1111111-1111-4111-8111-111111111111',
  version_id: 'v3333333-3333-4333-8333-333333333333',
  label: 'v3',
  seq: 3,
  published_at: '2026-10-28T10:00:00.000Z',
  rollback_of: null,
};

function signIn(scopes: string[]): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: null,
      name: null,
      role: 'agent',
      organization_id: 'o-1',
      license_id: '1',
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

function renderBand(): void {
  render(
    <MemoryRouter>
      <AiConfigPublishedBand />
    </MemoryRouter>,
  );
}

describe('AiConfigPublishedBand (AI-20 · tm 316.4)', () => {
  beforeEach(() => {
    resetAiConfigNotice();
    signIn([]);
  });

  it('names the version a publication made live and reads the version bar again', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderBand();
    expect(screen.queryByTestId('ai-config-published-band')).toBeNull();

    act(() => applyPush(queryClient, 'ai_config_published', PUSH));
    expect(await screen.findByTestId('ai-config-published-band')).toHaveTextContent(
      'AI configuration v3 is live',
    );
    expect(screen.getByTestId('ai-config-published-band')).toHaveTextContent(
      'an open one keeps the version it started with',
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['playbook', 'ai-config'] });
    // A team member cannot read the configuration: no way to the versions.
    expect(screen.queryByRole('link', { name: 'See versions' })).toBeNull();
  });

  it('says a rollback is one, and offers the versions to who can read them', async () => {
    signIn(['agents-bot--all:ro']);
    renderBand();
    act(() => applyPush(new QueryClient(), 'ai_config_published', { ...PUSH, rollback_of: 'v1' }));
    expect(await screen.findByText('AI configuration rolled back: v3 is live')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See versions' })).toHaveAttribute(
      'href',
      `/app/playbook?view=versions&version=${PUSH.version_id}`,
    );
  });

  it('keeps the latest publication over an older replay, and drops a malformed one', async () => {
    const queryClient = new QueryClient();
    renderBand();
    act(() => applyPush(queryClient, 'ai_config_published', PUSH));
    act(() => applyPush(queryClient, 'ai_config_published', { ...PUSH, label: 'v2', seq: 2 }));
    act(() => applyPush(queryClient, 'ai_config_published', { ...PUSH, label: 'v9', seq: 'x' }));
    expect(await screen.findByTestId('ai-config-published-band')).toHaveTextContent(
      'AI configuration v3 is live',
    );
  });

  it('hides on dismiss', async () => {
    const user = userEvent.setup();
    renderBand();
    act(() => applyPush(new QueryClient(), 'ai_config_published', PUSH));
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('ai-config-published-band')).toBeNull();
  });
});
