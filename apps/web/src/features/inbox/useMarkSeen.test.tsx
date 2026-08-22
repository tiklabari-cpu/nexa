/**
 * The read-receipt hook (FR-MOD-02.2.2): the newest visible event's timestamp,
 * debounced 1s, becomes `POST /chats/{chatId}/seen`. The unread badge itself
 * is untouched here — it already comes straight from the server
 * (`ChatSummary.unread_count`) — this only closes the gap that nothing ever
 * wrote the marker driving it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarkSeen } from './useInbox.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const CHAT_A = 'TJ1H8CFKRV';
const CHAT_B = 'TJ1H8CFKRW';

type Props = { chatId: string | null; seenUpTo: string | null };

function renderMarkSeen(initialProps: Props) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(({ chatId, seenUpTo }: Props) => useMarkSeen(chatId, seenUpTo), {
    initialProps,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  api.post.mockReset();
  api.post.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMarkSeen', () => {
  it('does nothing while there is no open chat or no visible event yet', () => {
    renderMarkSeen({ chatId: null, seenUpTo: null });
    vi.advanceTimersByTime(5_000);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the latest visible event as seen_up_to after the debounce window', () => {
    const seenUpTo = '2026-08-22T10:00:00.000Z';
    renderMarkSeen({ chatId: CHAT_A, seenUpTo });

    vi.advanceTimersByTime(999);
    expect(api.post).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_A}/seen`, { seen_up_to: seenUpTo });
  });

  it('debounces a burst of new events into a single request for the latest one', () => {
    const { rerender } = renderMarkSeen({
      chatId: CHAT_A,
      seenUpTo: '2026-08-22T10:00:00.000Z',
    });

    vi.advanceTimersByTime(500);
    rerender({ chatId: CHAT_A, seenUpTo: '2026-08-22T10:00:00.500Z' });
    vi.advanceTimersByTime(500);
    rerender({ chatId: CHAT_A, seenUpTo: '2026-08-22T10:00:01.000Z' });
    // Each new event pushes the deadline back — nothing has fired yet.
    expect(api.post).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_A}/seen`, {
      seen_up_to: '2026-08-22T10:00:01.000Z',
    });
  });

  it('flushes the previous chat immediately when the selection switches', () => {
    const { rerender } = renderMarkSeen({
      chatId: CHAT_A,
      seenUpTo: '2026-08-22T10:00:00.000Z',
    });

    // Switch before chat A's 1s debounce ever fires.
    vi.advanceTimersByTime(200);
    rerender({ chatId: CHAT_B, seenUpTo: '2026-08-22T11:00:00.000Z' });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenNthCalledWith(1, `/chats/${CHAT_A}/seen`, {
      seen_up_to: '2026-08-22T10:00:00.000Z',
    });

    // Chat B still debounces normally from here.
    vi.advanceTimersByTime(999);
    expect(api.post).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenNthCalledWith(2, `/chats/${CHAT_B}/seen`, {
      seen_up_to: '2026-08-22T11:00:00.000Z',
    });
  });

  it('flushes a pending mark when the chat closes (selection goes to null)', () => {
    const { rerender } = renderMarkSeen({
      chatId: CHAT_A,
      seenUpTo: '2026-08-22T10:00:00.000Z',
    });

    vi.advanceTimersByTime(100);
    rerender({ chatId: null, seenUpTo: null });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_A}/seen`, {
      seen_up_to: '2026-08-22T10:00:00.000Z',
    });

    // Nothing left pending — time passing afterwards fires nothing more.
    vi.advanceTimersByTime(5_000);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending mark on unmount instead of dropping it', () => {
    const { unmount } = renderMarkSeen({
      chatId: CHAT_A,
      seenUpTo: '2026-08-22T10:00:00.000Z',
    });

    vi.advanceTimersByTime(100);
    unmount();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_A}/seen`, {
      seen_up_to: '2026-08-22T10:00:00.000Z',
    });
  });

  it('swallows a failed request — a lagging badge is not worth surfacing', () => {
    api.post.mockRejectedValueOnce(new Error('network down'));
    renderMarkSeen({ chatId: CHAT_A, seenUpTo: '2026-08-22T10:00:00.000Z' });

    // The `.catch` is attached in the same tick the request fires, so no
    // unhandled rejection is possible regardless of when it settles.
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
