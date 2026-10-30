/**
 * Cards in the Inbox transcript (EN-02 · tm 353): a `rich_message` drawn as
 * its card, read only, and a player's message sent by a card button marked
 * with the button — for a campaign card, with the card as the player saw it
 * and the pressed button ringed.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { Transcript } from './Transcript.js';
import type { ChatEvent } from './types.js';

const CARD = {
  title: 'Deposit trouble?',
  body: 'We can help.',
  buttons: [
    { label: 'Get help', style: 'primary', action: { type: 'send_message' } },
    {
      label: 'Rules',
      style: 'default',
      action: { type: 'open_url', url: 'https://casino.test/r' },
    },
    { label: 'Copy', style: 'default', action: { type: 'copy_coupon', code: 'WELCOME50' } },
  ],
};

function event(overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    id: 'TJ1H8CFKRV_1',
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'message',
    text: 'Get help',
    author_id: 'cust-1',
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-10-30T10:00:00.000Z',
    ...overrides,
  };
}

const transcript = (events: ChatEvent[]) => (
  <Transcript chatId="TJ1H8CFKRV" events={events} loading={false} currentAgentId="a-1" />
);

describe('Transcript — cards (EN-02)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('shows the campaign card and the button the player pressed (FR-MOD-03.3.2)', () => {
    render(
      transcript([
        event({
          properties: {
            postback: {
              source: 'campaign',
              campaign_id: 'c1',
              button: 0,
              label: 'Get help',
              card: CARD,
            },
          },
        }),
      ]),
    );
    const card = screen.getByTestId('campaign-card');
    expect(within(card).getByText('Campaign card')).toBeInTheDocument();
    expect(within(card).getByText('Deposit trouble?')).toBeInTheDocument();
    expect(within(card).getByText('Get help').closest('li')).toHaveAttribute(
      'data-pressed',
      'true',
    );
    expect(within(card).getByText('Opens https://casino.test/r')).toBeInTheDocument();
    expect(screen.getByText(/pressed “Get help”/)).toBeInTheDocument();
    // Read only: nothing on it can be clicked.
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
  });

  it('draws a rich_message as its card instead of its plain text', () => {
    render(
      transcript([
        event({
          id: 'TJ1H8CFKRV_2',
          type: 'rich_message',
          author_type: 'bot',
          author_id: null,
          text: 'Which method?\n1. Papara',
          properties: {
            card: {
              body: 'Which method?',
              buttons: [{ label: 'Papara', action: { type: 'send_message' } }],
            },
          },
        }),
        event({
          id: 'TJ1H8CFKRV_3',
          text: 'Papara',
          properties: {
            postback: { source: 'event', event_id: 'TJ1H8CFKRV_2', button: 0, label: 'Papara' },
          },
        }),
      ]),
    );
    expect(screen.getByText('Which method?')).toBeInTheDocument();
    expect(screen.queryByText(/1\. Papara/)).not.toBeInTheDocument();
    expect(screen.getByText('Sends this as the player')).toBeInTheDocument();
    expect(screen.getByText(/pressed “Papara”/)).toBeInTheDocument();
  });

  it('marks the press in Turkish too', () => {
    renderWithLocale(
      transcript([
        event({
          properties: {
            postback: { source: 'event', event_id: 'x_1', button: 0, label: 'Papara' },
          },
        }),
      ]),
      'tr',
    );
    expect(screen.getByText(/“Papara” butonuna bastı/)).toBeInTheDocument();
  });
});
