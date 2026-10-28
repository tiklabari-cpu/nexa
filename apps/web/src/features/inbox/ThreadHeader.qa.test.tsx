/**
 * The inbox's "QA'ya gönder" (tm 319.3 · AI-24): a Team Lead and up sees it on
 * a closed conversation, never on an open one or for a Team Member; it sends
 * the newest connection with the note and links the review; the API's
 * refusal reads as the QA sentence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import type { ChatDetail } from './types.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});
// The header's other parts read their own endpoints; this file is about one button.
vi.mock('../risk/RiskChips.js', () => ({ RiskChips: () => null }));
vi.mock('./AiModeControls.js', () => ({ AiModeControls: () => null }));

const { ThreadHeader } = await import('./ThreadHeader.js');
const { useAuth } = await import('../../lib/auth-store.js');

const CHAT_ID = 'TJ1H8CFKRV';
const THREAD_ID = 'TJ1H8CFKRV-2';
const REVIEW = 'c1111111-1111-4111-8111-111111111111';

function signIn(role: string): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: '11111111-1111-4111-8111-111111111111',
      email: 'lead@acme.localhost',
      name: 'Lead',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['chats--access:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function renderHeader(active: boolean): void {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThreadHeader
          chatId={CHAT_ID}
          threadId={THREAD_ID}
          chat={{ customer_id: 'cust-1', thread: null } as unknown as ChatDetail}
          customerName="Ayşe"
          active={active}
          onOpenTicket={vi.fn()}
          onOpenCopilot={vi.fn()}
          onShowDetails={null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('Send to QA (AI-24)', () => {
  it('is offered on a closed conversation to a Team Lead, not on an open one nor to a Team Member', () => {
    signIn('team_lead');
    renderHeader(false);
    expect(screen.getByRole('button', { name: 'Send to QA' })).toBeInTheDocument();
  });

  it('is not offered while the conversation is open', () => {
    signIn('admin');
    renderHeader(true);
    expect(screen.queryByRole('button', { name: 'Send to QA' })).toBeNull();
  });

  it('is not offered to a Team Member', () => {
    signIn('agent');
    renderHeader(false);
    expect(screen.queryByRole('button', { name: 'Send to QA' })).toBeNull();
  });

  it('sends the newest connection with the note, and links the review', async () => {
    signIn('team_lead');
    renderHeader(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send to QA' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Note for the reviewer/), 'Yanlış limit');
    api.post.mockResolvedValueOnce({ id: REVIEW });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to QA' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/qa/reviews', {
        chat_id: CHAT_ID,
        thread_id: THREAD_ID,
        note: 'Yanlış limit',
      }),
    );
    expect(await within(dialog).findByText(/The review is in the AI quality queue/)).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Open the review' })).toHaveAttribute(
      'href',
      `/app/reports/ai-quality/${REVIEW}`,
    );
  });

  it('says why a conversation cannot go', async () => {
    signIn('team_lead');
    renderHeader(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send to QA' }));
    api.post.mockRejectedValueOnce(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'no ai',
        requestId: 'r-1',
        details: { problems: [{ field: 'thread_id', code: 'no_ai' }] },
      }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to QA' }));
    expect(
      await within(dialog).findByText('The AI took no part in this conversation.'),
    ).toBeInTheDocument();
  });
});
