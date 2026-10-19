/**
 * The "Sensitive data hidden" badge (tm 300.2 · AI-26).
 *
 * The server masks a password, a code or a card out of a message before it is
 * stored and names what it hid in `properties.sensitive_types`. Without the
 * badge an agent reading `Şifrem ********` cannot tell a masked secret from a
 * player who typed asterisks; with it they know what was there and that the
 * value is gone on purpose. A client cannot set the key — the server strips it
 * — so the badge is only ever the server's word.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { Transcript } from './Transcript.js';
import type { ChatEvent } from './types.js';

function event(overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    id: 'TJ1H8CFKRV_1',
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'message',
    text: 'SMS kodu ********',
    author_id: 'cust-1',
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: { sensitive_types: ['otp'] },
    created_at: '2026-10-19T10:00:00.000Z',
    ...overrides,
  };
}

function transcript(events: ChatEvent[]) {
  return <Transcript chatId="TJ1H8CFKRV" events={events} loading={false} currentAgentId="a-1" />;
}

describe('Transcript — sensitive data badge', () => {
  afterEach(() => {
    resetLocale();
  });

  it('names what the server hid, in catalogue order', () => {
    render(transcript([event({ properties: { sensitive_types: ['otp', 'card', 'password'] } })]));
    expect(screen.getByText('Sensitive data hidden (Card, OTP, Password)')).toBeInTheDocument();
  });

  it('shows nothing on a message with nothing masked, or with an unknown value', () => {
    render(
      transcript([
        event({ id: 'TJ1H8CFKRV_1', text: 'Param yatmadı', properties: {} }),
        event({ id: 'TJ1H8CFKRV_2', text: 'hello', properties: { sensitive_types: ['phone'] } }),
      ]),
    );
    expect(screen.queryByText(/Sensitive data hidden/)).not.toBeInTheDocument();
  });

  it('badges a team message too — the agent policy masks a code an agent typed', () => {
    render(transcript([event({ author_type: 'agent', author_id: 'a-2', text: 'kod ********' })]));
    expect(screen.getByText('Sensitive data hidden (OTP)')).toBeInTheDocument();
  });

  it('reads in Turkish when that is the active locale', () => {
    renderWithLocale(transcript([event()]), 'tr');
    expect(screen.getByText('Hassas veri gizlendi (OTP)')).toBeInTheDocument();
  });
});
