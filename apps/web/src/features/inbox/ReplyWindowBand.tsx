/**
 * WhatsApp's 24-hour window, in the composer (tm 380 · KN-01).
 *
 * A business may write free text on WhatsApp only within 24 hours of the
 * customer's last message; after that Meta takes only approved templates, and
 * this release sends none (05 KN-01 decision 3). So past the window a reply
 * cannot reach the customer, and the composer says so before the agent writes
 * one — the API refuses it all the same (`400`, `channel_window_closed`).
 * Internal notes are untouched: they never leave the workspace.
 *
 * The window is the server's answer (`GET /chats/{id}/reply-window`), asked
 * only where WhatsApp runs live: everywhere else every chat is open and the
 * question would be one request per chat for nothing. The answer is re-asked
 * when it would change by itself — the moment the window closes — and while
 * closed, every half minute, so a customer writing again reopens it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactElement } from 'react';
import { useApiClient } from '../../lib/auth-store.js';
import { useDeployment } from '../../lib/deployment.js';
import { useTranslate } from '../../lib/i18n.js';
import { isWhatsAppLive } from '../../lib/live-apps.js';

export interface ReplyWindow {
  chat_id: string;
  channel: string | null;
  live: boolean;
  open: boolean;
  closes_at: string | null;
}

export function replyWindowKey(chatId: string): readonly unknown[] {
  return ['chat', chatId, 'reply-window'];
}

/** The chat's reply window, or null where none applies (WhatsApp not live, still loading). */
export function useReplyWindow(chatId: string): ReplyWindow | null {
  const api = useApiClient();
  const client = useQueryClient();
  const live = isWhatsAppLive(useDeployment());
  const query = useQuery({
    queryKey: replyWindowKey(chatId),
    queryFn: () => api.get<ReplyWindow>(`/chats/${chatId}/reply-window`),
    enabled: live,
    staleTime: 15_000,
    refetchInterval: (current) =>
      current.state.data && current.state.data.live && !current.state.data.open ? 30_000 : false,
  });
  const data = live ? (query.data ?? null) : null;

  // Close on time: an open window ends at `closes_at` without anyone writing.
  const closesAt = data?.live && data.open && data.closes_at ? Date.parse(data.closes_at) : null;
  useEffect(() => {
    if (closesAt === null || !Number.isFinite(closesAt)) return;
    const wait = closesAt - Date.now();
    // Past timers this far out are not worth holding; a refetch on focus covers them.
    if (wait > 24 * 60 * 60 * 1000) return;
    const timer = setTimeout(
      () => void client.invalidateQueries({ queryKey: replyWindowKey(chatId) }),
      Math.max(0, wait) + 500,
    );
    return () => clearTimeout(timer);
  }, [closesAt, chatId, client]);

  return data;
}

/** Whether the window keeps a reply (not a note) from going out. */
export function replyWindowClosed(window: ReplyWindow | null): boolean {
  return window !== null && window.live && !window.open;
}

/** The band above the composer while the window is closed. */
export function ReplyWindowBand({ window }: { window: ReplyWindow | null }): ReactElement | null {
  const t = useTranslate();
  if (!replyWindowClosed(window)) return null;
  return (
    <div
      role="note"
      data-testid="reply-window-closed"
      className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-content"
    >
      <p className="font-medium">{t('inbox.composer.replyWindow.title')}</p>
      <p className="text-2xs text-content-secondary">{t('inbox.composer.replyWindow.body')}</p>
    </div>
  );
}
