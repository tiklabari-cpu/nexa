/**
 * Reply Suggestions in the composer (FR-MOD-02.3.2).
 *
 * The acceptance criterion is one sentence — "chip → editable text in the
 * composer" — and it was already met. What this file adds, and what tm 219 is
 * about, is the other half of the PRD line: where the words come from and which
 * language they are in. So there are two groups of assertions here.
 *
 * The **regressions** pin what must not move: a chip still fills the reply field
 * with editable text, Space still fires only in an empty reply (a full field
 * types a space like any other key), Escape still closes, a note still gets no
 * chips, and the row is still at most four wide.
 *
 * The **new** ones pin the source and the language: a Turkish console is offered
 * Turkish chips and not one of the sentences the generator used to hard-code;
 * Copilot's knowledge-base draft joins the row at its head when it answers; and
 * a Copilot that refuses, answers empty or never answers at all leaves the agent
 * with exactly the chips they already had, on screen, with no error in the way.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';
import { eventsKey } from './useInbox.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { inbox as trInbox } from '../../locales/tr/inbox.js';
import type { ReactElement } from 'react';
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

/**
 * What `POST /copilot/chats/{id}/reply` does in a given test.
 *
 * `'silent'` is the timeout case and the reason this is a function rather than a
 * fixture: a promise that never settles is the only honest way to ask "what does
 * the agent see while the provider is thinking, and after we stop waiting for
 * it".
 */
type CopilotBehaviour =
  { kind: 'draft'; draft: string } | { kind: 'empty' } | { kind: 'refuse' } | { kind: 'silent' };

function stubFetch(copilot: CopilotBehaviour = { kind: 'empty' }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes('/copilot/chats/')) {
        if (copilot.kind === 'silent') return new Promise<never>(() => {});
        if (copilot.kind === 'refuse') {
          return {
            ok: false,
            status: 402,
            headers: { get: () => null },
            json: async () => ({ error: { type: 'entitlement_required' } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ draft: copilot.kind === 'draft' ? copilot.draft : '', sources: [] }),
        };
      }
      // Everything else the composer asks for on mount (the canned-reply library).
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ items: [] }),
      };
    }),
  );
}

function composer(events: ChatEvent[]): { client: QueryClient; ui: ReactElement } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The shape a paged transcript keeps: pages newest-first, and newest-first
  // inside each page (`useTranscript`). These fixtures read oldest-first, the
  // order the transcript renders, so one page reversed is the same history.
  if (events.length > 0) {
    client.setQueryData(eventsKey('CHAT1'), {
      pages: [{ items: [...events].reverse() }],
      pageParams: [undefined],
    });
  }
  return {
    client,
    ui: (
      <QueryClientProvider client={client}>
        <Composer chatId="CHAT1" disabled={false} />
      </QueryClientProvider>
    ),
  };
}

function setup(events: ChatEvent[] = [], copilot?: CopilotBehaviour): HTMLTextAreaElement {
  stubFetch(copilot);
  render(composer(events).ui);
  return screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement;
}

/** The same composer with the console in Turkish. */
function setupTurkish(events: ChatEvent[] = [], copilot?: CopilotBehaviour): HTMLTextAreaElement {
  stubFetch(copilot);
  renderWithLocale(composer(events).ui, 'tr');
  return screen.getByLabelText(trInbox['inbox.composer.replyLabel']!) as HTMLTextAreaElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('Composer — Reply Suggestions (FR-MOD-02.3.2)', () => {
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

  it('offers at most four chips', async () => {
    // The widest case: a question leads with two lines and the two holding
    // replies follow. One more and the row stops being scannable at a glance.
    const input = setup([customerSaid('Do you ship to Germany?')]);
    fireEvent.keyDown(input, { key: ' ' });
    const group = await screen.findByRole('group', { name: 'Reply suggestions' });
    // `getAllByRole` includes the dismiss "×", which is not a suggestion.
    const chips = within(group)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-label') === null);
    expect(chips).toHaveLength(4);
  });

  it('does not open suggestions once the field has text', async () => {
    const input = setup();
    await userEvent.type(input, 'Hi ');
    // The trailing space typed normally rather than triggering the chips.
    expect(input.value).toBe('Hi ');
    expect(screen.queryByRole('group', { name: 'Reply suggestions' })).toBeNull();
  });

  it('types a space mid-sentence rather than reopening the chips', async () => {
    // The regression the shortcut is one keystroke away from: Space is a normal
    // character everywhere except an empty reply field, and an agent who cannot
    // put a space in a sentence cannot use the product at all.
    const input = setup();
    fireEvent.keyDown(input, { key: ' ' });
    await screen.findByRole('group', { name: 'Reply suggestions' });

    await userEvent.type(input, 'Sure');
    // Typing retracted the row; the next space belongs to the sentence.
    expect(screen.queryByRole('group', { name: 'Reply suggestions' })).toBeNull();
    await userEvent.type(input, ' thing');
    expect(input.value).toBe('Sure thing');
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

  describe('speaks the agent’s language', () => {
    it('offers Turkish chips to a Turkish console, and none of the old English ones', async () => {
      const input = setupTurkish([customerSaid('Siparişimi iptal etmek istiyorum.')]);
      fireEvent.keyDown(input, { key: ' ' });

      const group = await screen.findByRole('group', {
        name: trInbox['inbox.composer.suggestions.ariaLabel']!,
      });

      // The lead is shaped to what the customer said — read in Turkish, which
      // the English-only patterns could not do — and said in Turkish.
      const chips = within(group)
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-label') === null)
        .map((button) => button.textContent ?? '');

      expect(chips[0]).toBe(trInbox['inbox.composer.suggestions.chip.order']);
      expect(chips).toContain(trInbox['inbox.composer.suggestions.chip.holdingBear']);

      // The regression that made this task exist: the sentences the generator
      // used to hard-code must not be on screen in a Turkish session.
      for (const english of [
        /bear with me/i,
        /give me a moment/i,
        /happy to help/i,
        /how can i help you today/i,
      ]) {
        expect(chips.some((chip) => english.test(chip))).toBe(false);
      }
    });

    it('hands a Turkish chip to the composer unchanged (KK, in Turkish)', async () => {
      const input = setupTurkish([customerSaid('Merhaba')]);
      fireEvent.keyDown(input, { key: ' ' });

      const group = await screen.findByRole('group', {
        name: trInbox['inbox.composer.suggestions.ariaLabel']!,
      });
      const greeting = trInbox['inbox.composer.suggestions.chip.greeting']!;
      await userEvent.click(within(group).getByRole('button', { name: greeting }));

      await waitFor(() => expect(input.value).toBe(greeting));
    });
  });

  describe('Copilot is the second source, never the only one', () => {
    it('puts the knowledge-base draft at the head of the row when it answers', async () => {
      const input = setup([customerSaid('Can I get a refund?')], {
        kind: 'draft',
        draft: 'A refund over five hundred dollars needs a manager’s approval.',
      });
      fireEvent.keyDown(input, { key: ' ' });
      const group = await screen.findByRole('group', { name: 'Reply suggestions' });

      // The template chips are there on the same tick as the keystroke; the
      // Copilot draft joins them when the round-trip returns.
      const draft = await within(group).findByRole('button', { name: /five hundred dollars/i });
      const chips = within(group)
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-label') === null);
      expect(chips[0]).toBe(draft);
      // One lead plus the two holding replies plus the draft — still inside the
      // four the row is budgeted for.
      expect(chips).toHaveLength(4);

      // And it hands over exactly like any other chip.
      await userEvent.click(draft);
      await waitFor(() =>
        expect(input.value).toBe('A refund over five hundred dollars needs a manager’s approval.'),
      );
    });

    it('leaves the template chips alone when Copilot is refused', async () => {
      const input = setup([customerSaid('Can I get a refund?')], { kind: 'refuse' });
      fireEvent.keyDown(input, { key: ' ' });
      const group = await screen.findByRole('group', { name: 'Reply suggestions' });

      // No error notice, no empty row — an assist that failed is not something
      // to put in front of an agent mid-conversation.
      await waitFor(() => expect(screen.queryByText('Copilot is drafting…')).toBeNull());
      expect(
        within(group).getByRole('button', { name: /pull up the details/i }),
      ).toBeInTheDocument();
      expect(within(group).getByRole('button', { name: /bear with me/i })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('adds nothing when the knowledge base has no answer', async () => {
      const input = setup([customerSaid('Can I get a refund?')], { kind: 'empty' });
      fireEvent.keyDown(input, { key: ' ' });
      const group = await screen.findByRole('group', { name: 'Reply suggestions' });

      await waitFor(() => expect(screen.queryByText('Copilot is drafting…')).toBeNull());
      const chips = within(group)
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-label') === null);
      expect(chips).toHaveLength(3);
      expect(chips[0]?.textContent).toMatch(/pull up the details/i);
    });

    it('stops waiting after the budget and keeps the chips it already had', async () => {
      vi.useFakeTimers();
      try {
        const input = setup([customerSaid('Can I get a refund?')], { kind: 'silent' });
        fireEvent.keyDown(input, { key: ' ' });
        const group = screen.getByRole('group', { name: 'Reply suggestions' });

        // While it is thinking, the row says so — and is already usable.
        expect(within(group).getByRole('status')).toHaveTextContent('Copilot is drafting…');
        expect(within(group).getByRole('button', { name: /pull up the details/i })).toBeTruthy();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_500);
        });

        // The wait is over; the chips the agent had are the chips they keep.
        expect(within(group).queryByRole('status')).toBeNull();
        expect(within(group).getByRole('button', { name: /pull up the details/i })).toBeTruthy();
        expect(within(group).getByRole('button', { name: /bear with me/i })).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
