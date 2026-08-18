/**
 * The agent-facing "visitor is typing" line (FR-MOD-02.9 / 11.8). It must stay
 * invisible when nobody is typing — so it can sit unconditionally above the
 * composer without leaving a gap — and show the sneak-peek preview when one
 * arrived.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TypingIndicator } from './TypingIndicator.js';
import { useTypingStore } from './typing.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const CHAT = 'TJ1H8CFKRV';

describe('TypingIndicator', () => {
  beforeEach(() => {
    useTypingStore.setState({ byChat: {} });
  });
  afterEach(() => {
    useTypingStore.getState().clear(CHAT);
  });

  it('renders nothing when the visitor is not typing', () => {
    const { container } = render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the visitor when there is no preview yet', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, null);
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('Robin is typing…');
  });

  it('shows the sneak-peek preview when one arrived', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, 'my order is la');
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    const line = screen.getByTestId('typing-indicator');
    expect(line).toHaveTextContent('Robin');
    expect(line).toHaveTextContent('my order is la');
  });

  it('falls back to "Visitor" when the name is unknown', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, null);
    render(<TypingIndicator chatId={CHAT} customerName={null} />);
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('Visitor is typing…');
  });
});

describe('TypingIndicator localisation (NFR-I18N2)', () => {
  beforeEach(() => {
    useTypingStore.setState({ byChat: {} });
  });
  afterEach(() => {
    useTypingStore.getState().clear(CHAT);
    resetLocale();
  });

  it('paints the indicator in Turkish when that is the active locale', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, null);
    renderWithLocale(<TypingIndicator chatId={CHAT} customerName="Robin" />, 'tr');
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('Robin yazıyor…');
  });
});
