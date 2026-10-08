/**
 * The browser tab's title, from one writer (tm 259.20 · O15).
 *
 * Two things want `document.title`: the page the agent is on ("Inbox · SiyahTuş",
 * so a row of tabs and the history list tell screens apart) and the unread badge
 * ("(2) Inbox · SiyahTuş", legible from the taskbar). They used to be a
 * hard-coded `<title>` and a hook that overwrote it. Two writers racing for one
 * string means the later one wins and the other's part silently vanishes, so both
 * now only record their part here and `apply` composes the result.
 */
import { useEffect } from 'react';
import { notificationTitle } from '../features/notifications/notifications.js';

export const BASE_TITLE = 'SiyahTuş';

let pageTitle: string | null = null;
let unread = 0;

/** What the tab should say for a page title and an unread count. */
export function composeTitle(page: string | null, unreadCount: number): string {
  const base = page ? `${page} · ${BASE_TITLE}` : BASE_TITLE;
  return notificationTitle(base, unreadCount);
}

function apply(): void {
  if (typeof document === 'undefined') return;
  document.title = composeTitle(pageTitle, unread);
}

/** The unread badge's part. `useNotifications` is its only caller. */
export function setUnreadCount(count: number): void {
  unread = count;
  apply();
}

/**
 * Name the screen in the tab title while the calling component is mounted.
 * Leaving restores the bare product name, so a screen that does not name itself
 * never inherits the previous one's title.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    pageTitle = title || null;
    apply();
    return () => {
      pageTitle = null;
      apply();
    };
  }, [title]);
}
