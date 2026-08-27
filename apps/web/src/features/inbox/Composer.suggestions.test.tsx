/**
 * Reply Suggestions in the composer (FR-MOD-02.3.2).
 *
 * The acceptance criterion is one sentence — "chip → editable text in the
 * composer" — so that is what these pin: Space in an empty reply opens the chips,
 * a chip fills the reply field with text the agent can keep editing, and the
 * shortcut stays out of the way otherwise (nothing fires mid-sentence, Escape
 * closes it, a note never gets suggestions).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';
import { eventsKey } from './useInbox.js';
import type { ChatEvent } from './types.js';

function customerSaid(text: string): ChatEvent {
  return {
    id: `e-${text.length}`,
    chat_id: 'CHAT1',
    thread_id: 't1',
    type: 'message',
    text,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-07-26T00:00:00.000Z',
  };
}

function setup(events: ChatEvent[] = []): HTMLTextAreaElement {
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
  // The shape a paged transcript keeps: pages newest-first, and newest-first
  // inside each page (`useTranscript`). These fixtures read oldest-first, the
  // order the transcript renders, so one page reversed is the same history.
  if (events.length > 0) {
    queryClient.setQueryData(eventsKey('CHAT1'), {
      pages: [{ items: [...events].reverse() }],
      pageParams: [undefined],
    });
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
  return screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — Reply Suggestions', () => {
  it('fills the reply field with a chip, and the text stays editable (KK)', async () => {
    const input = setup([customerSaid('Do you ship to Germany?')]);
    expect(input.value).toBe('');

    // Space in the empty field asks for suggestions.
    fireEvent.keyDown(input, { key: ' ' });
    const group = await screen.findByRole('group', { name: 'Reply suggestions' });

    // The lead chip is shaped to the customer's question.
    const chip = within(group).getByRole('button', { name: /look into that/i });
    const chipText = chip.textContent ?? '';
    await userEvent.click(chip);

    // The chip's text lands in the composer, and the chips retract.
    await waitFor(() => expect(input.value).toBe(chipText));
    expect(screen.queryByRole('group', { name: 'Reply suggestions' })).toBeNull();

    // Editable: the field is a live reply draft, not a locked-in send — the agent
    // reworks it before sending.
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: `${chipText} Yes, we do!` } });
    expect(input.value).toBe(`${chipText} Yes, we do!`);
  });

  it('always offers chips, even before the customer has spoken', async () => {
    const input = setup();
    fireEvent.keyDown(input, { key: ' ' });
    const group = await screen.findByRole('group', { name: 'Reply suggestions' });
    // The safe holding replies plus the dismiss control — never an empty row.
    expect(within(group).getAllByRole('button').length).toBeGreaterThanOrEqual(2);
    expect(within(group).getByRole('button', { name: /bear with me/i })).toBeInTheDocument();
  });

  it('does not open suggestions once the field has text', async () => {
    const input = setup();
    await userEvent.type(input, 'Hi ');
    // The trailing space typed normally rather than triggering the chips.
    expect(input.value).toBe('Hi ');
    expect(screen.queryByRole('group', { name: 'Reply suggestions' })).toBeNull();
  });

  it('closes the suggestions on Escape (the shortcut is reversible)', async () => {
    const input = setup();
    fireEvent.keyDown(input, { key: ' ' });
    await screen.findByRole('group', { name: 'Reply suggestions' });

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Reply suggestions' })).toBeNull(),
    );
  });

  it('offers no suggestions while composing an internal note', async () => {
    const input = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    fireEvent.keyDown(input, { key: ' ' });
    // Nothing to wait on; assert the chips never appeared after a tick.
    await Promise.resolve();
    expect(screen.queryByRole('group', { name: 'Reply suggestions' })).toBeNull();
  });
});
