/**
 * The open conversation's header gives way to the visitor's name (tm 259.12 ·
 * UX audit O3 + O4).
 *
 * jsdom has no layout, so what is pinned here is the decision, not the pixels:
 * given a header width, which of the header's parts are drawn and under what
 * names. The pixels — the name's room, the Details panel inside the viewport,
 * 1280 and 1440 × en and tr — are `inbox-header-layout.spec.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadHeader } from './ThreadHeader.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', () => ({ useApiClient: () => api }));

const CHAT_ID = 'TJ1H8CFKRV';

/** What `clientWidth` answers for every element — jsdom's own answer is 0. */
let width = 0;
let notify: (() => void) | null = null;

beforeEach(() => {
  width = 0;
  notify = null;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
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
  resetLocale();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

function header(showDetails: (() => void) | null = null) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const element = (
    <QueryClientProvider client={client}>
      <ThreadHeader
        chatId={CHAT_ID}
        customerName="Alexandria Montgomery-Fitzro"
        active
        onOpenTicket={vi.fn()}
        onOpenCopilot={vi.fn()}
        onShowDetails={showDetails}
      />
    </QueryClientProvider>
  );
  return element;
}

describe('ThreadHeader', () => {
  it('draws the full header when nothing can be measured, and the id with it', () => {
    render(header());
    expect(screen.getByText(CHAT_ID)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveTextContent('Copy link');
    expect(screen.getByRole('button', { name: 'Create ticket' })).toHaveTextContent(
      'Create ticket',
    );
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveTextContent('Copilot');
  });

  it('keeps every action under its name when there is no room for words', () => {
    width = 284;
    render(header(() => {}));

    // Names survive as `aria-label` — the e2e suite and a screen reader find them.
    for (const name of ['Copy link', 'Create ticket', 'Copilot', 'Show details panel']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('title', name);
      expect(button).toHaveTextContent(/^.?$/);
    }
    // The id is in the Details panel already; the status keeps its word for a reader.
    expect(screen.queryByText(CHAT_ID)).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toHaveClass('sr-only');
    // The name is what is left, whole in the DOM and in full on hover.
    expect(screen.getByRole('heading', { name: 'Alexandria Montgomery-Fitzro' })).toHaveAttribute(
      'title',
      'Alexandria Montgomery-Fitzro',
    );
  });

  it('follows the header as it is resized — collapsing the panel gives the words back', () => {
    width = 284;
    render(header());
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveTextContent(/^.?$/);

    width = 764;
    act(() => notify?.());
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveTextContent('Copilot');
    expect(screen.getByText(CHAT_ID)).toBeInTheDocument();
  });

  it('names the actions in Turkish, narrow too', () => {
    width = 284;
    renderWithLocale(header(), 'tr');
    expect(screen.getByRole('button', { name: 'Bağlantıyı kopyala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talep oluştur' })).toBeInTheDocument();
  });

  it('opens the ticket subject in a card, not in the header, and leaves the button where it was', () => {
    width = 284;
    render(header());
    const trigger = screen.getByRole('button', { name: 'Create ticket' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    const subject = screen.getByLabelText('Ticket subject');
    expect(subject).toHaveValue('Follow-up for Alexandria Montgomery-Fitzro');
    // Same button, same place — now the one that closes it.
    expect(screen.getByRole('button', { name: 'Create ticket' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // The field hangs under the header (absolute), it is not one of its flex children.
    const card = subject.closest('div[class*="absolute"]');
    expect(card).not.toBeNull();
    expect(card?.parentElement?.tagName).toBe('HEADER');

    fireEvent.keyDown(subject, { key: 'Escape' });
    expect(screen.queryByLabelText('Ticket subject')).not.toBeInTheDocument();
  });
});
