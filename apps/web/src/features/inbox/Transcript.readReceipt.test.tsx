/**
 * "Read · time" under the last team message the player had on screen (IN-05 ·
 * tm 362).
 *
 * The player's `seen_up_to` is a point in time, so the line is drawn once — on
 * the newest message from an agent or the AI at or before it — and never on an
 * internal note, a system line or a message still being sent. Nothing is drawn
 * for a marker that is missing: showing too little beats a "read" that never
 * happened.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { Transcript } from './Transcript.js';
import { readReceiptEventId } from './readReceipt.js';
import type { ChatEvent } from './types.js';

function event(id: string, at: string, overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    id,
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'message',
    text: `text ${id}`,
    author_id: 'agent-1',
    author_type: 'agent',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: `2026-10-31T${at}.000Z`,
    ...overrides,
  };
}

const ASK = event('e1', '10:00:00', { author_type: 'customer', author_id: 'cust-1' });
const FIRST = event('e2', '10:00:10');
const SECOND = event('e3', '10:00:20');
const NOTE = event('e4', '10:00:25', { recipients: 'agents' });
const THIRD = event('e5', '10:00:30');

describe('readReceiptEventId', () => {
  it('picks the newest team message at or before the marker (IN-05)', () => {
    const events = [ASK, FIRST, SECOND, THIRD];
    expect(readReceiptEventId(events, '2026-10-31T10:00:20.000Z')).toBe('e3');
    expect(readReceiptEventId(events, '2026-10-31T10:00:29.000Z')).toBe('e3');
    expect(readReceiptEventId(events, '2026-10-31T10:00:30.000Z')).toBe('e5');
  });

  it('draws nothing for a marker before every team message, or a missing one (IN-05)', () => {
    const events = [ASK, FIRST];
    expect(readReceiptEventId(events, '2026-10-31T10:00:05.000Z')).toBeNull();
    expect(readReceiptEventId(events, null)).toBeNull();
    expect(readReceiptEventId(events, undefined)).toBeNull();
    expect(readReceiptEventId(events, 'not a date')).toBeNull();
  });

  it('never lands on an internal note, a system line or a message still being sent (IN-05)', () => {
    const system = event('e6', '10:00:26', { type: 'system_message', author_type: 'system' });
    const pending = event('e7', '10:00:27', { properties: { pending: true } });
    const events = [FIRST, SECOND, NOTE, system, pending];
    expect(readReceiptEventId(events, '2026-10-31T10:01:00.000Z')).toBe('e3');
  });

  it('counts the AI as the team, and not the player (IN-05)', () => {
    const bot = event('e8', '10:00:15', { author_type: 'bot', author_id: 'bot-1' });
    const late = event('e9', '10:00:40', { author_type: 'customer', author_id: 'cust-1' });
    expect(readReceiptEventId([FIRST, bot, late], '2026-10-31T10:01:00.000Z')).toBe('e8');
  });
});

describe('Transcript — read receipt', () => {
  afterEach(() => {
    resetLocale();
  });

  function show(events: ChatEvent[], seenUpTo: string | null) {
    return render(
      <Transcript
        chatId="TJ1H8CFKRV"
        events={events}
        loading={false}
        currentAgentId="agent-1"
        customerSeenUpTo={seenUpTo}
      />,
    );
  }

  it('shows one line, under the last message the player read, and none under the earlier ones (IN-05)', () => {
    show([ASK, FIRST, SECOND, THIRD], '2026-10-31T10:00:25.000Z');

    const lines = screen.getAllByTestId('read-receipt');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toMatch(/^Read · /);
    // Directly after the second message's own row — not the third.
    const second = document.querySelector('[data-event-id="e3"]')!;
    expect(second.nextElementSibling).toBe(lines[0]);
  });

  it('gives an internal note no receipt, even when it is the newest thing before the marker (IN-05)', () => {
    show([FIRST, NOTE], '2026-10-31T10:00:59.000Z');

    const lines = screen.getAllByTestId('read-receipt');
    expect(lines).toHaveLength(1);
    expect(document.querySelector('[data-event-id="e2"]')!.nextElementSibling).toBe(lines[0]);
    expect(document.querySelector('[data-event-id="e4"]')!.nextElementSibling).toBeNull();
  });

  it('shows nothing before the player has read anything (IN-05)', () => {
    show([ASK, FIRST], null);
    expect(screen.queryByTestId('read-receipt')).not.toBeInTheDocument();
  });

  it('is worded in the agent language: "Okundu" in Turkish (IN-05)', () => {
    renderWithLocale(
      <Transcript
        chatId="TJ1H8CFKRV"
        events={[FIRST]}
        loading={false}
        currentAgentId="agent-1"
        customerSeenUpTo="2026-10-31T10:00:15.000Z"
      />,
      'tr',
    );
    expect(screen.getByTestId('read-receipt').textContent).toMatch(/^Okundu · /);
  });
});
