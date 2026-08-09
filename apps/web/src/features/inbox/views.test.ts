/**
 * The inbox "Views" group (FR-MOD-02.1.4). The unit contract is exactly the
 * acceptance criterion — no channel connected → the promo shows, and a custom
 * saved view can be added and comes back on reload — plus the storage guards
 * the group must not crash on when `localStorage` is unavailable.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addSavedView,
  canReadChannels,
  connectedChannelViews,
  loadSavedViews,
  removeSavedView,
  saveSavedViews,
  showChannelPromo,
  useSavedViews,
  type ConnectedChannelLike,
  type SavedView,
} from './views.js';

const STORAGE_KEY = 'nexa.inbox.saved-views';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('channel views', () => {
  it('shows the promo when no channel is connected', () => {
    // The acceptance criterion: "kanal bağlı değilse channel-promo".
    expect(showChannelPromo([])).toBe(true);
    expect(connectedChannelViews([])).toEqual([]);
  });

  it('treats a channel that exists but is off as not connected', () => {
    const channels: ConnectedChannelLike[] = [{ type: 'whatsapp', connected: false }];
    expect(showChannelPromo(channels)).toBe(true);
    expect(connectedChannelViews(channels)).toEqual([]);
  });

  it('lists one view per connected channel and hides the promo', () => {
    const channels: ConnectedChannelLike[] = [
      { type: 'whatsapp', connected: true },
      { type: 'messenger', connected: false },
    ];
    expect(showChannelPromo(channels)).toBe(false);
    expect(connectedChannelViews(channels)).toEqual([
      { type: 'whatsapp', label: 'WhatsApp', icon: '📱' },
    ]);
  });

  it('orders channels Messenger → WhatsApp → SMS → Instagram regardless of API order', () => {
    const channels: ConnectedChannelLike[] = [
      { type: 'instagram', connected: true },
      { type: 'twilio', connected: true },
      { type: 'whatsapp', connected: true },
      { type: 'messenger', connected: true },
    ];
    expect(connectedChannelViews(channels).map((v) => v.type)).toEqual([
      'messenger',
      'whatsapp',
      'twilio',
      'instagram',
    ]);
    // The provider type `twilio` surfaces to the agent as "SMS".
    expect(connectedChannelViews(channels).find((v) => v.type === 'twilio')?.label).toBe('SMS');
  });

  it('ignores an unknown channel type', () => {
    const channels: ConnectedChannelLike[] = [{ type: 'telegram', connected: true }];
    expect(connectedChannelViews(channels)).toEqual([]);
    expect(showChannelPromo(channels)).toBe(true);
  });

  it('lists a connected Instagram channel and hides the promo', () => {
    // KK: bağlı instagram → satır görünür; yalnız instagram bağlıyken promo GÖSTERİLMEZ.
    const channels: ConnectedChannelLike[] = [{ type: 'instagram', connected: true }];
    expect(connectedChannelViews(channels)).toEqual([
      { type: 'instagram', label: 'Instagram', icon: '📷' },
    ]);
    expect(showChannelPromo(channels)).toBe(false);
  });

  it('treats a disconnected Instagram channel as not connected', () => {
    const channels: ConnectedChannelLike[] = [{ type: 'instagram', connected: false }];
    expect(connectedChannelViews(channels)).toEqual([]);
    expect(showChannelPromo(channels)).toBe(true);
  });
});

describe('canReadChannels', () => {
  it('is true for an owner/admin holding a channels scope', () => {
    expect(canReadChannels(['channels--all:ro'])).toBe(true);
    expect(canReadChannels(['chats--all:rw', 'channels--all:rw'])).toBe(true);
  });

  it('is false for an ordinary agent without one', () => {
    expect(canReadChannels(['chats--access:rw', 'tickets--access:rw'])).toBe(false);
    expect(canReadChannels([])).toBe(false);
  });
});

describe('saved views store', () => {
  it('defaults to no saved views', () => {
    expect(loadSavedViews()).toEqual([]);
  });

  it('round-trips a saved view through storage', () => {
    const view: SavedView = { id: 'a', name: 'My waiting', base: 'my', traffic: 'waiting' };
    saveSavedViews([view]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([view]);
    expect(loadSavedViews()).toEqual([view]);
  });

  it('returns an empty list for malformed or non-array storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(loadSavedViews()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, '{"not":"an array"}');
    expect(loadSavedViews()).toEqual([]);
  });

  it('drops rows with an unknown base or traffic value', () => {
    const good: SavedView = { id: 'g', name: 'Good', base: 'all', traffic: 'all' };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        good,
        { id: 'b', name: 'Bad base', base: 'nope', traffic: 'all' },
        { id: 'c', name: 'Bad traffic', base: 'all', traffic: 'nope' },
        { id: 'd', name: 42, base: 'all', traffic: 'all' },
      ]),
    );
    expect(loadSavedViews()).toEqual([good]);
  });

  it('never throws when storage access is blocked', () => {
    const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(() => saveSavedViews([], blocked)).not.toThrow();
    expect(loadSavedViews(blocked)).toEqual([]);
  });
});

describe('addSavedView / removeSavedView', () => {
  it('appends a view built from a name and the current filter', () => {
    const { views, added } = addSavedView(
      [],
      { name: '  Unassigned & waiting  ', base: 'unassigned', traffic: 'waiting' },
      () => 'id-1',
    );
    expect(added).toEqual({
      id: 'id-1',
      name: 'Unassigned & waiting',
      base: 'unassigned',
      traffic: 'waiting',
    });
    expect(views).toHaveLength(1);
  });

  it('caps the name length', () => {
    const long = 'x'.repeat(80);
    const { added } = addSavedView([], { name: long, base: 'all', traffic: 'all' }, () => 'id');
    expect(added?.name).toHaveLength(40);
  });

  it('rejects an empty name and leaves the list unchanged', () => {
    const existing: SavedView[] = [{ id: 'a', name: 'A', base: 'all', traffic: 'all' }];
    const { views, added } = addSavedView(existing, { name: '   ', base: 'my', traffic: 'all' });
    expect(added).toBeNull();
    expect(views).toBe(existing);
  });

  it('removes a view by id and leaves the rest', () => {
    const list: SavedView[] = [
      { id: 'a', name: 'A', base: 'all', traffic: 'all' },
      { id: 'b', name: 'B', base: 'my', traffic: 'waiting' },
    ];
    expect(removeSavedView(list, 'a')).toEqual([list[1]]);
    expect(removeSavedView(list, 'missing')).toEqual(list);
  });
});

describe('useSavedViews', () => {
  it('adds a view, persists it, and survives a reload', () => {
    const first = renderHook(() => useSavedViews());
    expect(first.result.current.views).toEqual([]);

    let created: SavedView | null = null;
    act(() => {
      created = first.result.current.add({ name: 'Queue', base: 'queued', traffic: 'queued' });
    });
    expect(created).not.toBeNull();
    expect(first.result.current.views).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
    first.unmount();

    // A fresh mount is what a reload is: the hook re-reads storage on init.
    const second = renderHook(() => useSavedViews());
    expect(second.result.current.views).toHaveLength(1);
    expect(second.result.current.views[0]!.name).toBe('Queue');
  });

  it('does not store a view with an empty name', () => {
    const { result } = renderHook(() => useSavedViews());
    let created: SavedView | null = { id: 'x', name: 'x', base: 'all', traffic: 'all' };
    act(() => {
      created = result.current.add({ name: '', base: 'all', traffic: 'all' });
    });
    expect(created).toBeNull();
    expect(result.current.views).toEqual([]);
  });

  it('removes a saved view', () => {
    const { result } = renderHook(() => useSavedViews());
    let id = '';
    act(() => {
      id = result.current.add({ name: 'Temp', base: 'all', traffic: 'all' })!.id;
    });
    expect(result.current.views).toHaveLength(1);
    act(() => result.current.remove(id));
    expect(result.current.views).toEqual([]);
    expect(loadSavedViews()).toEqual([]);
  });
});
