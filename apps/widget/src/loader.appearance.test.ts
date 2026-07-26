/**
 * The loader's part of widget customization (FR-MOD-11.7): it forwards the
 * appearance the snippet set to the widget document, and — the one thing only
 * the loader can do, because only it sees the host viewport — opens the frame
 * full-screen on a phone rather than as a card that overhangs the edge.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boot, type NexaWidgetConfig } from './loader.js';

type TestWindow = Window & { __nexa?: NexaWidgetConfig & { destroy?: () => void } };

function setup(config: Partial<NexaWidgetConfig>): TestWindow {
  document.body.replaceChildren();
  const win = window as TestWindow;
  win.__nexa = { organizationId: 'org-1', widgetOrigin: 'https://widget.test', ...config };
  return win;
}

const frame = () => document.getElementById('nexa-widget-frame') as HTMLIFrameElement | null;

function dispatch(type: string): void {
  const el = frame()!;
  const event = new MessageEvent('message', { data: { type }, origin: 'https://widget.test' });
  Object.defineProperty(event, 'source', { value: el.contentWindow });
  window.dispatchEvent(event);
}

/** jsdom fixes innerWidth at 1024; force a phone width for the geometry tests. */
function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

const originalWidth = window.innerWidth;

afterEach(() => {
  setViewportWidth(originalWidth);
  (window as TestWindow).__nexa?.destroy?.();
  document.body.replaceChildren();
});

describe('loader appearance forwarding', () => {
  it('forwards a customised appearance to the widget document', () => {
    boot(
      setup({
        primaryColor: '#e11d48',
        theme: 'dark',
        position: 'bottom-left',
        mobileFullscreen: false,
        poweredBy: false,
      }),
    );
    const src = new URL(frame()!.src);
    expect(src.searchParams.get('color')).toBe('#e11d48');
    expect(src.searchParams.get('theme')).toBe('dark');
    expect(src.searchParams.get('position')).toBe('bottom-left');
    // Booleans ride as `0` only when turned off, keeping the URL short.
    expect(src.searchParams.get('mobile_full')).toBe('0');
    expect(src.searchParams.get('powered_by')).toBe('0');
  });

  it('forwards nothing extra for an un-customised install', () => {
    boot(setup({}));
    const src = new URL(frame()!.src);
    expect(src.searchParams.has('color')).toBe(false);
    expect(src.searchParams.has('theme')).toBe(false);
    expect(src.searchParams.has('mobile_full')).toBe(false);
    expect(src.searchParams.has('powered_by')).toBe(false);
  });
});

describe('loader mobile fullscreen', () => {
  beforeEach(() => setViewportWidth(390));

  it('fills the viewport when the panel opens on a phone', () => {
    boot(setup({ mobileFullscreen: true }));
    dispatch('nexa:open');

    const el = frame()!;
    expect(el.style.width).toBe('100%');
    expect(el.style.height).toBe('100%');
    expect(el.style.top).toBe('0px');
    expect(el.style.bottom).toBe('0px');
  });

  it('returns to the corner launcher when the panel closes', () => {
    boot(setup({ mobileFullscreen: true }));
    dispatch('nexa:open');
    dispatch('nexa:close');

    const el = frame()!;
    expect(el.style.width).toBe('84px');
    expect(el.style.height).toBe('84px');
    expect(el.style.top).toBe('');
    expect(el.style.right).toBe('16px');
  });

  it('stays a floating card on a phone when fullscreen is turned off', () => {
    boot(setup({ mobileFullscreen: false }));
    // Widget asks for its panel size; without fullscreen the loader honours it.
    const el = frame()!;
    const event = new MessageEvent('message', {
      data: { type: 'nexa:resize', width: 380, height: 620 },
      origin: 'https://widget.test',
    });
    Object.defineProperty(event, 'source', { value: el.contentWindow });
    dispatch('nexa:open');
    window.dispatchEvent(event);

    expect(el.style.width).toBe('380px');
    expect(el.style.height).toBe('620px');
  });
});
