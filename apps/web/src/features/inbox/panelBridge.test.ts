/**
 * The custom panel bridge's message gate (KN-05 · K29 gate 3 · tm 379).
 *
 * A message is acted on only from the frame's own window, with the frame's
 * channel nonce, and from the panel's origin or the opaque `"null"` a
 * sandboxed frame without `allow-same-origin` reports. Another origin, another
 * window, a missing or wrong nonce: ignored, silently.
 */
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PANEL_HEIGHT_MAX,
  CUSTOM_PANEL_HEIGHT_MIN,
  CUSTOM_PANEL_INSERT_TEXT_MAX,
} from '@siyahtus/types';
import {
  clampPanelHeight,
  contextMessage,
  newPanelChannel,
  panelFrameSrc,
  panelLinkHref,
  readPanelMessage,
  type PanelFrame,
} from './panelBridge.js';

const frameWindow = { name: 'the panel frame' } as unknown as Window;
const otherWindow = { name: 'somebody else' } as unknown as Window;
const FRAME: PanelFrame = { window: frameWindow, origin: 'https://bo.example', channel: 'c0ffee' };

const event = (
  data: unknown,
  overrides: Partial<{ source: MessageEventSource | null; origin: string }> = {},
) => ({ source: frameWindow, origin: 'null', data, ...overrides });

describe('which messages the console acts on', () => {
  it('takes ready, resize and insert_text from the frame with its channel', () => {
    expect(readPanelMessage(event({ type: 'siyahtus:ready', channel: 'c0ffee' }), FRAME)).toEqual({
      type: 'ready',
    });
    expect(
      readPanelMessage(event({ type: 'siyahtus:resize', channel: 'c0ffee', height: 480.4 }), FRAME),
    ).toEqual({ type: 'resize', height: 480 });
    expect(
      readPanelMessage(
        event({ type: 'siyahtus:insert_text', channel: 'c0ffee', text: 'Bakiyeniz güncel.' }),
        FRAME,
      ),
    ).toEqual({ type: 'insert_text', text: 'Bakiyeniz güncel.' });
  });

  it('accepts the opaque "null" origin a sandboxed frame reports, and the registered origin', () => {
    const ready = { type: 'siyahtus:ready', channel: 'c0ffee' };
    expect(readPanelMessage(event(ready, { origin: 'null' }), FRAME)).not.toBeNull();
    expect(readPanelMessage(event(ready, { origin: 'https://bo.example' }), FRAME)).not.toBeNull();
  });

  it('ignores a message from another origin, even from the frame window with the channel', () => {
    for (const origin of [
      'https://evil.example',
      'https://bo.example.evil',
      'http://bo.example',
      '',
    ]) {
      expect(
        readPanelMessage(
          event({ type: 'siyahtus:insert_text', channel: 'c0ffee', text: 'x' }, { origin }),
          FRAME,
        ),
        origin,
      ).toBeNull();
    }
  });

  it('ignores another window — a pop-up, a second frame, the console itself', () => {
    const ready = { type: 'siyahtus:ready', channel: 'c0ffee' };
    expect(readPanelMessage(event(ready, { source: otherWindow }), FRAME)).toBeNull();
    expect(readPanelMessage(event(ready, { source: null }), FRAME)).toBeNull();
    expect(readPanelMessage(event(ready), { ...FRAME, window: null })).toBeNull();
  });

  it('ignores a page that never saw the nonce (navigated away) and anything malformed', () => {
    expect(readPanelMessage(event({ type: 'siyahtus:ready' }), FRAME)).toBeNull();
    expect(readPanelMessage(event({ type: 'siyahtus:ready', channel: 'guess' }), FRAME)).toBeNull();
    expect(readPanelMessage(event('siyahtus:ready'), FRAME)).toBeNull();
    expect(readPanelMessage(event(null), FRAME)).toBeNull();
    expect(
      readPanelMessage(event({ type: 'siyahtus:send_message', channel: 'c0ffee' }), FRAME),
    ).toBeNull();
    expect(
      readPanelMessage(
        event({ type: 'siyahtus:resize', channel: 'c0ffee', height: 'tall' }),
        FRAME,
      ),
    ).toBeNull();
    expect(
      readPanelMessage(
        event({ type: 'siyahtus:insert_text', channel: 'c0ffee', text: '   ' }),
        FRAME,
      ),
    ).toBeNull();
  });

  it('clamps a height and cuts an over-long suggestion', () => {
    expect(clampPanelHeight(10)).toBe(CUSTOM_PANEL_HEIGHT_MIN);
    expect(clampPanelHeight(1e9)).toBe(CUSTOM_PANEL_HEIGHT_MAX);
    const long = readPanelMessage(
      event({ type: 'siyahtus:insert_text', channel: 'c0ffee', text: 'a'.repeat(5000) }),
      FRAME,
    );
    expect(long).toEqual({ type: 'insert_text', text: 'a'.repeat(CUSTOM_PANEL_INSERT_TEXT_MAX) });
  });
});

describe('addresses (GV-05)', () => {
  it('puts only the channel nonce in the frame address, in the fragment', () => {
    const channel = newPanelChannel();
    expect(channel).toMatch(/^[0-9a-f]{32}$/);
    expect(newPanelChannel()).not.toBe(channel);
    expect(panelFrameSrc('https://bo.example/card?view=1', channel)).toBe(
      `https://bo.example/card?view=1#siyahtus_channel=${channel}`,
    );
  });

  it('puts the link token in the new-tab address fragment', () => {
    expect(panelLinkHref('https://bo.example/card', 'a.b.c')).toBe(
      'https://bo.example/card#siyahtus_token=a.b.c',
    );
  });

  it('answers ready with the channel, the token and its expiry', () => {
    expect(contextMessage('c0ffee', 't.o.k', '2026-11-03T10:05:00.000Z')).toEqual({
      type: 'siyahtus:context',
      channel: 'c0ffee',
      token: 't.o.k',
      expires_at: '2026-11-03T10:05:00.000Z',
    });
  });
});
