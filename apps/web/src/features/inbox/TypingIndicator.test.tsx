/**
 * The visitor-draft strip above the composer (FR-MOD-02.9 / 11.8 · tm 417.6).
 * The live region is always there and says one thing per draft; the draft is
 * plain text outside it, stays as "has not sent this yet" when keys stop, and
 * holds its height while it grows.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypingIndicator } from './TypingIndicator.js';
import { TYPING_IDLE_MS, useTypingStore } from './typing.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const CHAT = 'TJ1H8CFKRV';
const note = (isTyping: boolean, text: string | null, seq?: number) =>
  act(() => useTypingStore.getState().noteCustomer(CHAT, isTyping, text, seq));

describe('TypingIndicator (FR-MOD-02.9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTypingStore.getState().clearAll();
  });
  afterEach(() => {
    act(() => useTypingStore.getState().clearAll());
    vi.useRealTimers();
  });

  it('FR-MOD-02.9 keeps an empty live region in the DOM before the first keystroke, and no strip', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByTestId('typing-indicator')).toBeNull();
  });

  it('FR-MOD-02.9 shows the dots and "{name}: “draft”" while keys arrive', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    note(true, 'my order is la', 1);
    const strip = screen.getByTestId('typing-indicator');
    expect(strip).toHaveTextContent('Robin: “my order is la”');
    expect(strip.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByTestId('typing-preview-draft')).toBeNull();
  });

  it('FR-MOD-02.9 after 6 s with no keystroke the dots go and the draft stays as "has not sent this yet"', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    note(true, 'my order is la', 1);
    act(() => vi.advanceTimersByTime(TYPING_IDLE_MS + 1));

    expect(screen.getByTestId('typing-preview-draft')).toHaveTextContent(
      'Robin has not sent this yet',
    );
    expect(screen.getByTestId('typing-preview-text')).toHaveTextContent('“my order is la”');
    expect(screen.getByTestId('typing-indicator').querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('FR-MOD-02.9 the live region names the visitor once, never reads the draft, and does not change on idle or typing again', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    const status = screen.getByRole('status');
    note(true, 'secret draft', 1);
    const announced = status.textContent;
    expect(announced).toBe('Robin is typing…');
    expect(announced).not.toContain('secret draft');
    expect(status).not.toContainElement(screen.getByTestId('typing-preview-text'));

    act(() => vi.advanceTimersByTime(TYPING_IDLE_MS + 1));
    expect(status.textContent).toBe(announced);
    note(true, 'secret draft 2', 2);
    expect(status.textContent).toBe(announced);

    note(false, null, 3);
    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByTestId('typing-indicator')).toBeNull();
  });

  it('FR-MOD-02.9 draws the draft as plain text — a link stays text, markup stays text, no tooltip', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    note(true, 'see https://evil.test/x and <b>bold</b> **bold**', 1);
    const strip = screen.getByTestId('typing-indicator');
    expect(strip.querySelector('a')).toBeNull();
    expect(strip.querySelector('b')).toBeNull();
    expect(strip.querySelector('[title]')).toBeNull();
    expect(screen.getByTestId('typing-preview-text')).toHaveTextContent(
      '“see https://evil.test/x and <b>bold</b> **bold**”',
    );
  });

  it('FR-MOD-02.9 holds a fixed three-line box whether the draft is one line or three', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    note(true, 'one line', 1);
    const box = screen.getByTestId('typing-preview-text').parentElement!;
    const oneLine = box.className;
    expect(box).toHaveClass('line-clamp-3', 'min-h-[3.375rem]', 'overflow-hidden');
    expect(box).toHaveClass('whitespace-pre-wrap', 'break-words');

    note(true, 'one\ntwo\nthree\nfour', 2);
    const grown = screen.getByTestId('typing-preview-text').parentElement!;
    // Same element, same sizing classes: only the italic tone differs on idle.
    expect(grown).toBe(box);
    expect(grown.className).toBe(oneLine);
  });

  it('FR-MOD-02.9 clamps to two lines in the phone layout', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" compact />);
    note(true, 'draft', 1);
    const box = screen.getByTestId('typing-preview-text').parentElement!;
    expect(box).toHaveClass('line-clamp-2', 'min-h-[2.25rem]');
    expect(box).not.toHaveClass('line-clamp-3');
  });

  it('names the visitor when a bare indicator carries no draft', () => {
    render(<TypingIndicator chatId={CHAT} customerName="Robin" />);
    note(true, null);
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('Robin is typing…');
  });

  it('falls back to "Visitor" when the name is unknown', () => {
    render(<TypingIndicator chatId={CHAT} customerName={null} />);
    note(true, null);
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('Visitor is typing…');
  });
});

describe('TypingIndicator localisation (NFR-I18N2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTypingStore.getState().clearAll();
  });
  afterEach(() => {
    act(() => useTypingStore.getState().clearAll());
    vi.useRealTimers();
    resetLocale();
  });

  it('paints the indicator in Turkish when that is the active locale', () => {
    renderWithLocale(<TypingIndicator chatId={CHAT} customerName="Robin" />, 'tr');
    note(true, null);
    expect(screen.getByTestId('typing-indicator')).toHaveTextContent('Robin yazıyor…');
  });

  it('FR-MOD-02.9 says "henüz göndermedi" in Turkish once keys stop', () => {
    renderWithLocale(<TypingIndicator chatId={CHAT} customerName="Robin" />, 'tr');
    note(true, 'siparişim gelmedi', 1);
    expect(screen.getByRole('status')).toHaveTextContent('Robin yazıyor…');
    act(() => vi.advanceTimersByTime(TYPING_IDLE_MS + 1));
    expect(screen.getByTestId('typing-preview-draft')).toHaveTextContent('Robin henüz göndermedi');
  });
});
