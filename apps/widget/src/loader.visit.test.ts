/**
 * The loader's part of campaign targeting (EN-03 · tm 352.2): a single-page
 * site's page changes and the visitor heading for the way out, reported to the
 * widget frame only once the widget says the workspace has a campaign running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, PAGE_DEBOUNCE_MS, watchVisit, type SiyahTusWidgetConfig } from './loader.js';

type TestWindow = Window & { __siyahtus?: SiyahTusWidgetConfig & { destroy?: () => void } };

const frame = (): HTMLIFrameElement =>
  document.getElementById('siyahtus-widget-frame') as HTMLIFrameElement;

function fromFrame(data: Record<string, unknown>): void {
  const event = new MessageEvent('message', { data, origin: 'https://widget.test' });
  Object.defineProperty(event, 'source', { value: frame().contentWindow });
  window.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/home?token=secret#top');
});

afterEach(() => {
  (window as TestWindow).__siyahtus?.destroy?.();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('watchVisit', () => {
  it('reports a pushState once it settles, as origin + path without query or fragment', () => {
    const sent: unknown[] = [];
    const stop = watchVisit(window, (message) => sent.push(message));

    window.history.pushState({}, '', '/deposit?amount=5#step2');
    window.history.pushState({}, '', '/deposit/confirm?amount=5');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(PAGE_DEBOUNCE_MS);
    expect(sent).toEqual([
      { type: 'siyahtus:page', url: `${window.location.origin}/deposit/confirm` },
    ]);
    stop();
  });

  it('reports replaceState and back/forward, and nothing for a change that stays on the page', () => {
    const sent: Array<{ url?: string }> = [];
    const stop = watchVisit(window, (message) => sent.push(message));

    window.history.replaceState({}, '', '/pricing');
    vi.advanceTimersByTime(PAGE_DEBOUNCE_MS);
    expect(sent.map((m) => m.url)).toEqual([`${window.location.origin}/pricing`]);

    window.history.pushState({}, '', '/pricing?tab=2#x');
    vi.advanceTimersByTime(PAGE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);

    window.history.replaceState({}, '', '/home');
    window.dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(PAGE_DEBOUNCE_MS);
    expect(sent.at(-1)?.url).toBe(`${window.location.origin}/home`);
    stop();
  });

  it('lets a pushState that throws throw to the page, as it would unwatched', () => {
    const stop = watchVisit(window, () => undefined);
    expect(() => window.history.pushState({}, '', 'https://elsewhere.test/x')).toThrow();
    stop();
  });

  it('gives history back when stopped, unless someone wrapped it since', () => {
    const original = window.history.pushState;
    const stop = watchVisit(window, () => undefined);
    expect(window.history.pushState).not.toBe(original);
    stop();
    expect(window.history.pushState).toBe(original);

    const stopAgain = watchVisit(window, () => undefined);
    const theirs = vi.fn();
    window.history.pushState = theirs;
    stopAgain();
    expect(window.history.pushState).toBe(theirs);
    window.history.pushState = original;
  });

  it('reports the pointer leaving through the top edge, and only that', () => {
    const sent: unknown[] = [];
    const stop = watchVisit(window, (message) => sent.push(message));
    const out = (init: MouseEventInit): void => {
      document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, ...init }));
    };

    out({ clientY: 300 });
    out({ clientY: 0, relatedTarget: document.body });
    expect(sent).toEqual([]);
    out({ clientY: -2 });
    expect(sent).toEqual([{ type: 'siyahtus:exit-intent' }]);
    stop();
    out({ clientY: 0 });
    expect(sent).toHaveLength(1);
  });

  it('reports a fast scroll to the top on a phone only', () => {
    const sent: unknown[] = [];
    let scrollY = 900;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    const stop = watchVisit(window, (message) => sent.push(message));

    // Slowly: no sample inside the window falls far enough.
    for (const y of [850, 800, 750]) {
      vi.advanceTimersByTime(200);
      scrollY = y;
      window.dispatchEvent(new Event('scroll'));
    }
    expect(sent).toEqual([]);

    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    scrollY = 300;
    window.dispatchEvent(new Event('scroll'));
    expect(sent).toEqual([{ type: 'siyahtus:exit-intent' }]);

    // The same on a desktop-width window is just scrolling.
    width.mockReturnValue(1280);
    vi.advanceTimersByTime(200);
    scrollY = 900;
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    scrollY = 300;
    window.dispatchEvent(new Event('scroll'));
    expect(sent).toHaveLength(1);
    stop();
  });
});

describe('boot and campaign tracking', () => {
  function setup(): void {
    document.body.replaceChildren();
    const win = window as TestWindow;
    win.__siyahtus = { organizationId: 'org-1', widgetOrigin: 'https://widget.test' };
    boot(win);
  }

  it('leaves history alone until the widget reports a campaign running, then relays to the frame', () => {
    const original = window.history.pushState;
    setup();
    const sent: unknown[] = [];
    vi.spyOn(frame().contentWindow!, 'postMessage').mockImplementation((message: unknown) => {
      sent.push(message);
    });
    expect(window.history.pushState).toBe(original);

    fromFrame({ type: 'siyahtus:campaign-tracking' });
    expect(window.history.pushState).not.toBe(original);
    // A second report from a reloaded frame does not wrap it twice.
    const wrapped = window.history.pushState;
    fromFrame({ type: 'siyahtus:campaign-tracking' });
    expect(window.history.pushState).toBe(wrapped);

    window.history.pushState({}, '', '/deposit');
    vi.advanceTimersByTime(PAGE_DEBOUNCE_MS);
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0 }));
    expect(sent).toEqual([
      { type: 'siyahtus:page', url: `${window.location.origin}/deposit` },
      { type: 'siyahtus:exit-intent' },
    ]);

    (window as TestWindow).__siyahtus?.destroy?.();
    expect(window.history.pushState).toBe(original);
  });

  it("relays siyahtus('setSessionVariables') like any command", () => {
    setup();
    const sent: unknown[] = [];
    vi.spyOn(frame().contentWindow!, 'postMessage').mockImplementation((message: unknown) => {
      sent.push(message);
    });
    fromFrame({ type: 'siyahtus:ready' });
    (window as unknown as { siyahtus: (c: string, p?: object) => void }).siyahtus(
      'setSessionVariables',
      { plan: 'premium' },
    );
    expect(sent).toEqual([
      { type: 'siyahtus:command', command: 'setSessionVariables', payload: { plan: 'premium' } },
    ]);
  });
});
