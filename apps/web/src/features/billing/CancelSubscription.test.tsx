/**
 * Cancelling the subscription (tm 384 · BL-03): the owner's dialog — a reason
 * and the workspace's name before the button wakes up — the scheduled state
 * with "Undo cancellation", the ended state with the export links, and the
 * read-only view everyone else gets.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { SubscriptionCancellation } from './CancelSubscription.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { CancelSubscriptionSection } = await import('./CancelSubscription.js');

const RUNNING: SubscriptionCancellation = {
  scheduled: false,
  reason: null,
  requested_at: null,
  takes_effect_at: null,
  ended_at: null,
  export_until: null,
  data_deletion_at: null,
  can_cancel: true,
  can_resume: false,
  workspace_name: 'Acme Gaming',
};

const SCHEDULED: SubscriptionCancellation = {
  ...RUNNING,
  scheduled: true,
  reason: 'too_expensive',
  requested_at: '2026-11-01T10:00:00.000Z',
  takes_effect_at: '2026-12-01T00:00:00.000Z',
  can_cancel: false,
  can_resume: true,
};

const ENDED: SubscriptionCancellation = {
  ...RUNNING,
  ended_at: '2026-12-01T00:00:00.000Z',
  export_until: '2026-12-31T00:00:00.000Z',
  data_deletion_at: '2026-12-31T00:00:00.000Z',
  can_cancel: false,
};

function renderSection(cancellation: SubscriptionCancellation, canManage: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CancelSubscriptionSection cancellation={cancellation} canManage={canManage} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('CancelSubscriptionSection', () => {
  it('asks the owner for a reason and the workspace name before cancelling', async () => {
    api.post.mockResolvedValue({ cancellation: SCHEDULED });
    renderSection(RUNNING, true);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The rest of the period is not refunded.');
    expect(dialog).toHaveTextContent('You can read and export its data for 30 days after that.');
    const submit = screen.getByRole('button', { name: 'Cancel at period end' });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByLabelText('It is too expensive'));
    await userEvent.type(screen.getByLabelText('Type Acme Gaming to confirm'), 'Acme');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type Acme Gaming to confirm'), ' gaming');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/billing/subscription/cancel', {
        reason: 'too_expensive',
        confirmation: 'Acme gaming',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows when it ends and lets the owner undo it', async () => {
    api.post.mockResolvedValue({ cancellation: RUNNING });
    renderSection(SCHEDULED, true);
    expect(screen.getByTestId('cancel-scheduled')).toHaveTextContent('ends on');
    await userEvent.click(screen.getByRole('button', { name: 'Undo cancellation' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/subscription/resume', {}));
  });

  it('after the end, says until when it can be exported and where', () => {
    renderSection(ENDED, true);
    expect(screen.getByText('The subscription has ended')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export reports' })).toHaveAttribute(
      'href',
      '/app/reports',
    );
    expect(
      screen.getByRole('link', { name: 'Download conversations from the archive' }),
    ).toHaveAttribute('href', '/app/archive');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives everyone but the owner no buttons', () => {
    const running = renderSection(RUNNING, false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    running.unmount();
    renderSection(SCHEDULED, false);
    expect(screen.getByTestId('cancel-scheduled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo cancellation' })).not.toBeInTheDocument();
  });
});
