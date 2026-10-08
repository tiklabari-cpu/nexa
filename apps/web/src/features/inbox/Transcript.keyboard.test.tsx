/**
 * The transcript's own scroller and the keyboard (tm 259.26 · UX audit O16).
 *
 * The log is an `overflow-y-auto` box of message bubbles, and a bubble takes no
 * focus. Once a conversation outgrows the pane — a phone, a long thread — a
 * keyboard user has no way to scroll back through it (axe
 * `scrollable-region-focusable`, measured on the inbox at 390 px). So the log
 * becomes a tab stop while it overflows, the same rule `Page` follows: a
 * transcript that fits gets no extra stop.
 *
 * jsdom has no layout: the box is faked on the prototype and the
 * `ResizeObserver` is a stub whose callback the test fires.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transcript } from './Transcript.js';
import type { ChatEvent } from './types.js';

function message(seq: number): ChatEvent {
  return {
    id: `TJ1H8CFKRV_${seq}`,
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'thread-1',
    type: 'message',
    text: `m${seq}`,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: `2026-08-27T10:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

const thread = (count: number): ChatEvent[] =>
  Array.from({ length: count }, (_, i) => message(i + 1));

describe('Transcript scroller', () => {
  let scrollHeight = 0;
  let clientHeight = 0;
  let notify: (() => void) | null = null;

  beforeEach(() => {
    scrollHeight = 0;
    clientHeight = 0;
    notify = null;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => clientHeight,
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  const log = (): HTMLElement => screen.getByRole('log', { name: 'Conversation transcript' });

  it('is no tab stop while the conversation fits', () => {
    scrollHeight = 400;
    clientHeight = 400;
    render(
      <Transcript chatId="TJ1H8CFKRV" events={thread(3)} loading={false} currentAgentId={null} />,
    );
    expect(log()).not.toHaveAttribute('tabindex');
  });

  it('becomes a tab stop, with its ring drawn inside, once the conversation overflows', () => {
    scrollHeight = 1200;
    clientHeight = 400;
    render(
      <Transcript chatId="TJ1H8CFKRV" events={thread(30)} loading={false} currentAgentId={null} />,
    );
    expect(log()).toHaveAttribute('tabindex', '0');
    expect(log()).toHaveClass('focus-visible:-outline-offset-2');
  });

  it('follows the thread as messages arrive and the pane is resized', () => {
    scrollHeight = 400;
    clientHeight = 400;
    const { rerender } = render(
      <Transcript chatId="TJ1H8CFKRV" events={thread(3)} loading={false} currentAgentId={null} />,
    );
    expect(log()).not.toHaveAttribute('tabindex');

    // A new message grows the content: measured again on the new events.
    scrollHeight = 900;
    rerender(
      <Transcript chatId="TJ1H8CFKRV" events={thread(4)} loading={false} currentAgentId={null} />,
    );
    expect(log()).toHaveAttribute('tabindex', '0');

    // A taller pane (the window grew) fits it again.
    clientHeight = 900;
    act(() => notify?.());
    expect(log()).not.toHaveAttribute('tabindex');
  });

  it('measures the log once it replaces the loading skeleton', () => {
    scrollHeight = 1200;
    clientHeight = 400;
    const { rerender } = render(
      <Transcript chatId="TJ1H8CFKRV" events={[]} loading currentAgentId={null} />,
    );
    rerender(
      <Transcript chatId="TJ1H8CFKRV" events={thread(30)} loading={false} currentAgentId={null} />,
    );
    expect(log()).toHaveAttribute('tabindex', '0');
  });
});
