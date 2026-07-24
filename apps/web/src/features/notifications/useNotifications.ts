/**
 * The effect side of notifications (FR-MOD-13.8): turns a realtime push into a
 * sound, a desktop notification and an unread badge in the tab title/favicon.
 *
 * The decision of *whether* to do any of this is `decideNotification`, which is
 * pure and tested on its own; this hook only carries out what it returns and
 * owns the browser state the decision needs — focus and the unread count.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  decideNotification,
  loadPrefs,
  notificationTitle,
  type NotifiableEvent,
  type Permission,
} from './notifications.js';

/** The clean title the badge is layered on top of. */
const BASE_TITLE = 'Nexa';

export interface Notifier {
  /** Feed every realtime push through this; it decides and acts. */
  handlePush: (action: string, payload: Record<string, unknown>) => void;
}

export function useNotifications(): Notifier {
  const [unread, setUnread] = useState(0);

  // The title is imperative and shared with the whole document, so it is driven
  // from an effect rather than rendered — React does not own <title> here.
  useEffect(() => {
    document.title = notificationTitle(BASE_TITLE, unread);
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
      event: payload['event'] as NotifiableEvent | undefined,
      prefs: loadPrefs(),
      focused: isFocused(),
      permission: currentPermission(),
    });
    if (!decision) return;

    if (decision.badge) setUnread((n) => n + 1);
    if (decision.sound) playChime();
    if (decision.desktop) showDesktop(payload);
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

function showDesktop(payload: Record<string, unknown>): void {
  try {
    const event = payload['event'] as { text?: string } | undefined;
    new Notification('New message', {
      body: event?.text?.slice(0, 140) ?? 'A visitor sent a new message.',
      // One notification per chat replaces the last rather than stacking.
      tag: typeof payload['chat_id'] === 'string' ? (payload['chat_id'] as string) : undefined,
    });
  } catch {
    // Permission can be revoked between the check and here; never throw at an
    // agent for it.
  }
}

/**
 * A short two-tone chime, synthesised so the app ships no audio asset and needs
 * no network fetch. Best-effort: an AudioContext may be suspended until a user
 * gesture, which is a silent no-op rather than an error.
 */
function playChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => void ctx.close();
  } catch {
    // No audio device or a blocked context — the badge still tells the agent.
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
    ctx.fillText('N', 16, 17);

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
