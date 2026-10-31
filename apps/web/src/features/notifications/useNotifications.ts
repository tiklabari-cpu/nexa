/**
 * The effect side of notifications (FR-MOD-13.8): turns a realtime push into a
 * sound, a desktop notification and an unread badge in the tab title/favicon.
 *
 * The decision of *whether* to do any of this is `decideNotification`, which is
 * pure and tested on its own; this hook only carries out what it returns and
 * owns the browser state the decision needs — focus and the unread count.
 *
 * **Tabs and the repeating sound (IN-10 · tm 367).** Two tabs both receive every
 * push, and sound cannot be taken back, so one tab — the leader
 * (`leaderTab.ts`) — plays it, and only while nobody is looking at any console
 * tab. With "repeat" on, a visitor's message also registers with the
 * `SoundRepeater`, which chimes again every 10 s until the chat is read
 * ({@link noteChatSeen}, {@link setViewedChat}), 2 minutes pass, or another tab
 * reads it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { NotificationEvent } from '@siyahtus/types';
import { setUnreadCount } from '../../lib/document-title.js';
import { useAuth } from '../../lib/auth-store.js';
import { getLocale, translate } from '../../lib/i18n.js';
import { playChime } from './chime.js';
import { TabLeader, openLeaderChannel } from './leaderTab.js';
import { SoundRepeater } from './soundRepeater.js';
import {
  decideNotification,
  loadPrefs,
  type NotifyDecision,
  type NotifyMe,
  type Permission,
} from './notifications.js';

// --- The tab-wide runtime ------------------------------------------------------

interface Runtime {
  leader: TabLeader;
  repeater: SoundRepeater;
  /** The chat open in this tab, if any — read the moment the agent comes back. */
  viewing: string | null;
  dispose: () => void;
}

let runtime: Runtime | null = null;

/**
 * The leader election and the repeater, created on first use. One per tab (a
 * module singleton), because the hook is mounted by the shell once and the
 * inbox, which reports reads, is a different part of the tree.
 */
function getRuntime(): Runtime {
  if (runtime) return runtime;
  const leader = new TabLeader({ channel: openLeaderChannel(), isFocused });
  const repeater = new SoundRepeater({
    play: () => void playChime(),
    shouldPlay: () => mayMakeSound(leader),
  });
  leader.onCleared((key) => repeater.clear(key));
  leader.start();

  const rt: Runtime = { leader, repeater, viewing: null, dispose: () => undefined };
  // The agent coming back to this tab has seen the chat that is open in it.
  const returned = (): void => {
    if (isFocused() && rt.viewing) markRead(rt, rt.viewing);
  };
  const leave = (): void => leader.stop();
  window.addEventListener('focus', returned);
  document.addEventListener('visibilitychange', returned);
  window.addEventListener('pagehide', leave);
  rt.dispose = () => {
    window.removeEventListener('focus', returned);
    document.removeEventListener('visibilitychange', returned);
    window.removeEventListener('pagehide', leave);
    repeater.clearAll();
    leader.stop();
  };
  runtime = rt;
  return rt;
}

/** Tear the runtime down (tests, and a sign-out that wants a clean slate). */
export function resetNotificationRuntime(): void {
  runtime?.dispose();
  runtime = null;
}

/** Only the leader makes sound, and only while no console tab is being looked at. */
function mayMakeSound(leader: TabLeader): boolean {
  return leader.isLeader() && !isFocused() && !leader.anyPeerFocused();
}

function markRead(rt: Runtime, key: string): void {
  rt.repeater.clear(key);
  rt.leader.announceCleared(key);
}

/**
 * The chat open in this tab (null when none is on screen). Opening a chat ends
 * its repeating sound — at once if the agent is looking, otherwise the moment
 * they come back to the tab.
 */
export function setViewedChat(chatId: string | null): void {
  const rt = getRuntime();
  rt.viewing = chatId;
  if (chatId && isFocused()) markRead(rt, chatId);
}

/** The agent's read marker for `chatId` reached the server (`useMarkSeen`). */
export function noteChatSeen(chatId: string): void {
  if (isFocused()) markRead(getRuntime(), chatId);
}

/** Who is signed in, for "was this handed to me / my team?". */
function currentMe(): NotifyMe {
  const agent = useAuth.getState().agent;
  return { accountId: agent?.account_id ?? null, groupIds: agent?.group_ids ?? [] };
}

export interface Notifier {
  /** Feed every realtime push through this; it decides and acts. */
  handlePush: (action: string, payload: Record<string, unknown>) => void;
}

export function useNotifications(): Notifier {
  const [unread, setUnread] = useState(0);

  // The title is imperative and shared with the whole document, so it is driven
  // from an effect rather than rendered — React does not own <title> here. The
  // page's own name is the other half of it (`lib/document-title.ts`).
  useEffect(() => {
    setUnreadCount(unread);
    setFaviconBadge(unread > 0);
  }, [unread]);

  // Coming back to the tab means the agent has seen it: clear the badge.
  useEffect(() => {
    const clear = (): void => {
      if (isFocused()) setUnread(0);
    };
    window.addEventListener('focus', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('focus', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, []);

  const handlePush = useCallback((action: string, payload: Record<string, unknown>) => {
    // Read preferences fresh every time so a toggle in Settings takes effect
    // immediately, without this component having to re-mount or re-subscribe.
    const decision = decideNotification({
      action,
      payload,
      prefs: loadPrefs(),
      focused: isFocused(),
      permission: currentPermission(),
      me: currentMe(),
    });
    if (!decision) return;

    const rt = getRuntime();
    if (decision.badge) setUnread((n) => n + 1);

    // One tab speaks (the leader), and not over somebody who is looking at the
    // console in another tab.
    const speaks = mayMakeSound(rt.leader);
    if (decision.sound && speaks) void playChime();
    if (decision.desktop && rt.leader.isLeader() && !rt.leader.anyPeerFocused()) {
      showDesktop(payload, decision);
    }
    // Every tab keeps the entry so a leader that closes hands the beat on; only
    // the leader's ticks are audible.
    if (decision.repeat && decision.key) rt.repeater.start(decision.key);
  }, []);

  return { handlePush };
}

/** Ask the browser for desktop-notification permission; safe if unsupported. */
export async function requestNotificationPermission(): Promise<Permission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return currentPermission();
  }
}

export function currentPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function isFocused(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

// --- Effects -----------------------------------------------------------------

/** The title and body wording of each event; the visitor's own words are never here. */
const EVENT_WORDING: Record<
  Exclude<NotificationEvent, 'incoming_chat'>,
  { title: string; body: string }
> = {
  transferred_to_me: {
    title: 'shell.notification.transferredToMe.title',
    body: 'shell.notification.transferredToMe.body',
  },
  transferred_to_my_team: {
    title: 'shell.notification.transferredToMyTeam.title',
    body: 'shell.notification.transferredToMyTeam.body',
  },
  queue_waiting: {
    title: 'shell.notification.queueWaiting.title',
    body: 'shell.notification.queueWaiting.body',
  },
  new_ticket: {
    title: 'shell.notification.newTicket.title',
    body: 'shell.notification.newTicket.body',
  },
  ticket_reply: {
    title: 'shell.notification.ticketReply.title',
    body: 'shell.notification.ticketReply.body',
  },
};

function showDesktop(payload: Record<string, unknown>, decision: NotifyDecision): void {
  try {
    // Not a component, so no `useTranslate`: the language is read when the push
    // arrives, which is also when a mid-session switch has already taken effect.
    const locale = getLocale();
    // One notification per chat or ticket replaces the last rather than stacking.
    const tag = decision.key ? `${decision.event}:${decision.key}` : decision.event;
    if (decision.event === 'incoming_chat') {
      const event = payload['event'] as { text?: string } | undefined;
      new Notification(translate(locale, 'shell.notification.title'), {
        body: event?.text?.slice(0, 140) ?? translate(locale, 'shell.notification.fallbackBody'),
        tag: typeof payload['chat_id'] === 'string' ? (payload['chat_id'] as string) : undefined,
      });
      return;
    }
    const wording = EVENT_WORDING[decision.event];
    new Notification(translate(locale, wording.title), {
      body: translate(locale, wording.body),
      tag,
    });
  } catch {
    // Permission can be revoked between the check and here; never throw at an
    // agent for it.
  }
}

/**
 * Draw a small dot on the favicon so the unread state survives even when the
 * tab title is truncated in a crowded tab bar. Regenerated rather than stored
 * because it is cheap and the base is a solid glyph.
 */
function setFaviconBadge(on: boolean): void {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#4f46e5';
    ctx.beginPath();
    ctx.roundRect(2, 2, 28, 28, 7);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', 16, 17);

    if (on) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(24, 8, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');
  } catch {
    // Favicon is a bonus over the title; a browser that cannot draw it loses
    // nothing else.
  }
}
