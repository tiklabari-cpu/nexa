/**
 * The inbox "Views" group (FR-MOD-02.1.4).
 *
 * Two things share one heading:
 *
 *  - Channel views. One entry per connected messaging channel
 *    (Messenger / WhatsApp / SMS). Until a workspace connects one there is
 *    nothing to list, so the section becomes a promo pointing at Settings →
 *    Channels rather than an empty group — "no channel connected → channel
 *    promo" is the acceptance criterion. Reading channel state needs the
 *    `channels--all` scope owners and admins hold; an ordinary agent works the
 *    inbox rather than configuring it, so the section is hidden for them
 *    instead of firing a request that 403s.
 *
 *  - Custom saved views. An agent captures the current filter (a base view plus
 *    a real-time tab) under a name and it comes back on every reload. These are
 *    per-browser like the right-panel preference, not account state: a saved
 *    view is a working convenience, not shared workspace configuration.
 *
 * Pure functions plus a storage-backed hook, so the branching (promo vs. list,
 * add / remove / round-trip) is tested in isolation the way `traffic` and
 * `rightPanel` are, not through the rendered sidebar.
 */
import { useState } from 'react';
import type { InboxView, TrafficTab } from './types.js';

/**
 * The messaging channels an inbox view can represent — the adapter channels
 * (FR-MOD-08.5.4-.6, FR-MOD-08.5.7), whose provider type `twilio` surfaces to
 * the agent as "SMS". Email and the Website widget resolve tenants their own
 * way and are not adapter channels, so they are not listed here.
 */
export type ChannelViewType = 'messenger' | 'twilio' | 'whatsapp' | 'instagram' | 'telegram';

export interface ChannelView {
  type: ChannelViewType;
  label: string;
  icon: string;
}

/**
 * Label and glyph per channel, matching the Settings → Channels grid so the
 * same channel reads the same in both places. The key order is the fixed rail
 * order the views render in.
 */
const CHANNEL_VIEW_META: Record<ChannelViewType, { label: string; icon: string }> = {
  messenger: { label: 'Messenger', icon: '📨' },
  whatsapp: { label: 'WhatsApp', icon: '📱' },
  twilio: { label: 'SMS', icon: '💬' },
  instagram: { label: 'Instagram', icon: '📷' },
  telegram: { label: 'Telegram', icon: '✈️' },
};

/** The `/channels` row shape, narrowed to what the Views group reads. */
export interface ConnectedChannelLike {
  type: string;
  connected: boolean;
}

function isChannelViewType(value: string): value is ChannelViewType {
  return (
    value === 'messenger' ||
    value === 'twilio' ||
    value === 'whatsapp' ||
    value === 'instagram' ||
    value === 'telegram'
  );
}

/**
 * The channel views to show: one per connected, known channel, in the fixed
 * Messenger → WhatsApp → SMS → Instagram order (stable rather than whatever
 * order the API returned). A disconnected or unrecognised channel yields
 * nothing.
 */
export function connectedChannelViews(channels: ConnectedChannelLike[]): ChannelView[] {
  const connected = new Set(
    channels.filter((c) => c.connected && isChannelViewType(c.type)).map((c) => c.type),
  );
  return (Object.keys(CHANNEL_VIEW_META) as ChannelViewType[])
    .filter((type) => connected.has(type))
    .map((type) => ({ type, ...CHANNEL_VIEW_META[type] }));
}

/**
 * Whether to show the channel promo instead of a channel list: true when no
 * known channel is connected. This is the "kanal bağlı değilse channel-promo"
 * acceptance criterion.
 */
export function showChannelPromo(channels: ConnectedChannelLike[]): boolean {
  return connectedChannelViews(channels).length === 0;
}

/**
 * Whether the session may read channel state (owner / admin). Ordinary agents
 * lack the `channels--all` scope, so the channel section — promo included — is
 * hidden for them rather than firing a request that comes back 403.
 */
export function canReadChannels(scopes: string[]): boolean {
  return scopes.includes('channels--all:ro') || scopes.includes('channels--all:rw');
}

// --- Custom saved views ------------------------------------------------------

/** A named filter an agent saved: a base view plus a real-time tab. */
export interface SavedView {
  id: string;
  name: string;
  base: InboxView;
  traffic: TrafficTab;
}

/** The filter a "Save current view" action captures. */
export interface SavedViewInput {
  name: string;
  base: InboxView;
  traffic: TrafficTab;
}

const STORAGE_KEY = 'nexa.inbox.saved-views';
export const SAVED_VIEW_NAME_MAX = 40;

const BASE_VIEWS: InboxView[] = [
  'all',
  'my',
  'queued',
  'unassigned',
  'archived',
  'ai',
  'ai_solved',
];
const TRAFFIC_TABS: TrafficTab[] = ['all', 'chatting', 'queued', 'waiting'];

/** `localStorage` can throw on access (private mode, sandboxed frames). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Accept only well-formed rows, so a hand-edited or stale `localStorage` value
 * — or a token from an older build — can never render a broken view button or
 * apply a filter the inbox does not understand.
 */
function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['base'] === 'string' &&
    (BASE_VIEWS as string[]).includes(v['base']) &&
    typeof v['traffic'] === 'string' &&
    (TRAFFIC_TABS as string[]).includes(v['traffic'])
  );
}

/** Read the saved views, dropping anything malformed. */
export function loadSavedViews(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): SavedView[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedView) : [];
  } catch {
    return [];
  }
}

/** Persist the saved views; a write that fails simply resets on the next load. */
export function saveSavedViews(
  views: SavedView[],
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // A view that cannot be remembered is not worth failing the click over.
  }
}

/**
 * A stable-enough id for a saved view. `crypto.randomUUID` where available,
 * else a short random fallback — the id only needs to be unique within one
 * browser's saved list.
 */
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the fallback
  }
  return `sv_${Math.random().toString(36).slice(2)}`;
}

/**
 * Append a saved view built from a name and the current filter. The name is
 * trimmed and capped; an empty name is rejected — the list is returned
 * unchanged with `added: null` so the caller can keep its input open rather
 * than storing a nameless view.
 */
export function addSavedView(
  views: SavedView[],
  input: SavedViewInput,
  makeId: () => string = newId,
): { views: SavedView[]; added: SavedView | null } {
  const name = input.name.trim().slice(0, SAVED_VIEW_NAME_MAX);
  if (name.length === 0) return { views, added: null };
  const view: SavedView = { id: makeId(), name, base: input.base, traffic: input.traffic };
  return { views: [...views, view], added: view };
}

/** Drop a saved view by id. */
export function removeSavedView(views: SavedView[], id: string): SavedView[] {
  return views.filter((v) => v.id !== id);
}

/**
 * The saved views, persisted across reloads. Returns the list and the two ways
 * to change it: `add` (returns the created view, or null if the name was
 * empty) and `remove`.
 */
export function useSavedViews(): {
  views: SavedView[];
  add: (input: SavedViewInput) => SavedView | null;
  remove: (id: string) => void;
} {
  // Lazy initialiser: read the remembered list once, on mount — which is what a
  // page reload replays.
  const [views, setViews] = useState<SavedView[]>(loadSavedViews);

  const apply = (next: SavedView[]): void => {
    setViews(next);
    saveSavedViews(next);
  };

  return {
    views,
    add: (input) => {
      const { views: next, added } = addSavedView(views, input);
      if (added) apply(next);
      return added;
    },
    remove: (id) => apply(removeSavedView(views, id)),
  };
}
