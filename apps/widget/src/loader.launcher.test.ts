/**
 * The loader's part of launcher visibility (WG-10 · tm 347): a frame the widget
 * asks to be zero-sized gives its corner back to the host page, the unread count
 * reaches the page as a window event, and `siyahtus('open')` is queued until the
 * widget can take it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, type SiyahTusWidgetConfig } from './loader.js';

type TestWindow = Window & { __siyahtus?: SiyahTusWidgetConfig & { destroy?: () => void } };

function setup(): TestWindow {
  document.body.replaceChildren();
  const win = window as TestWindow;
  win.__siyahtus = { organizationId: 'org-1', widgetOrigin: 'https://widget.test' };
  return win;
}

const frame = (): HTMLIFrameElement =>
  document.getElementById('siyahtus-widget-frame') as HTMLIFrameElement;

function post(data: Record<string, unknown>): void {
  const event = new MessageEvent('message', { data, origin: 'https://widget.test' });
  Object.defineProperty(event, 'source', { value: frame().contentWindow });
  window.dispatchEvent(event);
}

afterEach(() => {
  (window as TestWindow).__siyahtus?.destroy?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('loader launcher visibility (WG-10)', () => {
  it('gives the corner back to the page when the widget draws nothing', () => {
    boot(setup());
    post({ type: 'siyahtus:resize', width: 0, height: 0 });
    expect(frame().style.width).toBe('0px');
    expect(frame().style.height).toBe('0px');
    post({ type: 'siyahtus:resize', width: 124, height: 124 });
    expect(frame().style.width).toBe('124px');
    expect(frame().style.height).toBe('124px');
  });

  it('relays the unread count as a window event carrying only the number', () => {
    boot(setup());
    const seen: unknown[] = [];
    const listener = (event: Event): void => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener('siyahtus:unread', listener);
    post({ type: 'siyahtus:unread', count: 3, text: 'leaked' });
    post({ type: 'siyahtus:unread', count: -4 });
    post({ type: 'siyahtus:unread', count: 'many' });
    window.removeEventListener('siyahtus:unread', listener);
    expect(seen).toEqual([{ count: 3 }, { count: 0 }]);
  });

  it("queues siyahtus('open') until the widget is ready, then relays it", () => {
    boot(setup());
    const sent: unknown[] = [];
    vi.spyOn(frame().contentWindow!, 'postMessage').mockImplementation((message: unknown) => {
      sent.push(message);
    });
    (window as unknown as { siyahtus: (command: string) => void }).siyahtus('open');
    expect(sent).toEqual([]);
    post({ type: 'siyahtus:ready' });
    expect(sent).toEqual([{ type: 'siyahtus:command', command: 'open', payload: undefined }]);
  });
});
