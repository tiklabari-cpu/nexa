/**
 * The composer end of the Copilot hand-off (FR-MOD-12.3).
 *
 * A draft offered by Copilot must land in the reply field — as a reply, never an
 * internal note — ready for the agent to edit and send. The rest of the composer
 * (canned replies, attachments, typing) has its own coverage; this pins only the
 * hand-off.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';
import { offerDraft, useCopilotDraftStore } from './copilotDraft.js';

function renderComposer() {
  // The composer fetches the canned-reply library on mount; keep it quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    })),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCopilotDraftStore.setState({ byChat: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer ← Copilot draft', () => {
  it('fills the reply field with a drafted reply and consumes it', async () => {
    renderComposer();
    const input = screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
    expect(input.value).toBe('');

    act(() => offerDraft('CHAT1', 'Refunds over 500 go to finance.'));

    await waitFor(() => expect(input.value).toBe('Refunds over 500 go to finance.'));
    // Consumed, so a re-render does not re-apply it over the agent's edits.
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBeUndefined();
  });

  it('ignores a draft addressed to a different chat', async () => {
    renderComposer();
    const input = screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
    act(() => offerDraft('OTHER', 'not for this chat'));
    // Nothing to wait on — assert it stayed empty after a tick.
    await Promise.resolve();
    expect(input.value).toBe('');
  });
});
