/**
 * Widget customization (FR-MOD-11.7): the widget applies the appearance the
 * loader forwards, at mount, before any network call — so the launcher is
 * on-brand from the first paint. The KK is "tema uygular"; these pin it.
 *
 * The colour, forced scheme, corner and footer are all set on the real DOM
 * (`:root` style + attribute, a root class, the footer element), which is the
 * exact mechanism the CSS keys off, so asserting them is asserting the look.
 *
 * The "Powered by" footer (FR-MOD-11.5) is the one field with a second,
 * later source: the authenticated token mint (`appearanceFromApi`), gated
 * server-side by the `white_label` entitlement (11.5-b). The URL-params path
 * tested above is deliberately NOT a source for it any more (11.5-c) — a
 * visitor's browser controls that URL, so it must never be able to hide the
 * footer on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/widget.html${search}`);
}

function mountWith(search: string): HTMLElement {
  setUrl(search);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

const brandVar = (): string => document.documentElement.style.getPropertyValue('--nx-brand').trim();

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

let calls: string[] = [];

/** Stubs the token mint to report `powered_by` the way the server would. */
function stubFetchWithPoweredBy(poweredBy: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          widget: {
            primary_color: '#2d67fa',
            position: 'bottom-right',
            theme: 'auto',
            mobile_fullscreen: true,
            powered_by: poweredBy,
          },
        });
      }
      if (url.includes('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: null,
          events: [],
        });
      }
      return jsonResponse({});
    }),
  );
}

/** Opening the launcher is what triggers `connect()` — mounting alone does not. */
function openPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
}

async function waitFor(predicate: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('waitFor timed out');
}

beforeEach(() => {
  calls = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-nx-theme');
  document.documentElement.style.removeProperty('--nx-brand');
  // A mint stores `nexa.customer_id`, and since tm 195.1 that id makes the
  // next mount connect on its own (FR-MOD-11.1) — so one test's identity
  // would decide whether the next one's widget is connected before it opens.
  window.localStorage.clear();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('widget appearance', () => {
  it('applies the shipped defaults when the snippet customised nothing', () => {
    const root = mountWith('?organization_id=org-1');

    expect(brandVar()).toBe('#2d67fa');
    // `auto` leaves no override, so the prefers-color-scheme media query governs.
    expect(document.documentElement.hasAttribute('data-nx-theme')).toBe(false);
    // Default corner is bottom-right, so no left mirror.
    expect(root.classList.contains('nx-left')).toBe(false);
    // Full screen on mobile is on by default.
    expect(root.classList.contains('nx-mobile-full')).toBe(true);
    // The "Powered by" footer shows by default (FR-MOD-11.5).
    const powered = root.querySelector('.nx-powered') as HTMLElement;
    expect(powered).not.toBeNull();
    expect(powered.hidden).toBe(false);
    expect(powered.textContent).toContain('Powered by Nexa');
  });

  it('applies a brand colour from the loader query params', () => {
    mountWith('?organization_id=org-1&color=%23e11d48');
    expect(brandVar()).toBe('#e11d48');
  });

  it('ignores a colour that is not a hex, falling back to the default', () => {
    mountWith('?organization_id=org-1&color=red');
    expect(brandVar()).toBe('#2d67fa');
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ])('forces the %s colour scheme', (theme, expected) => {
    mountWith(`?organization_id=org-1&theme=${theme}`);
    expect(document.documentElement.getAttribute('data-nx-theme')).toBe(expected);
  });

  it('treats an unknown theme as auto', () => {
    mountWith('?organization_id=org-1&theme=solarized');
    expect(document.documentElement.hasAttribute('data-nx-theme')).toBe(false);
  });

  it('mirrors the launcher to the left corner', () => {
    const root = mountWith('?organization_id=org-1&position=bottom-left');
    expect(root.classList.contains('nx-left')).toBe(true);
  });

  it('drops mobile fullscreen when the snippet turned it off', () => {
    const root = mountWith('?organization_id=org-1&mobile_full=0');
    expect(root.classList.contains('nx-mobile-full')).toBe(false);
  });

  it('ignores a powered_by URL param — the footer stays until the server rules', () => {
    const root = mountWith('?organization_id=org-1&powered_by=0');
    const powered = root.querySelector('.nx-powered') as HTMLElement;
    expect(powered.hidden).toBe(false);
  });

  it('hides the "Powered by" footer when the authenticated mint says the workspace is entitled', async () => {
    stubFetchWithPoweredBy(false);
    const root = mountWith('?organization_id=org-1&powered_by=0');
    openPanel(root);
    await waitFor(() => (root.querySelector('.nx-powered') as HTMLElement).hidden);
    expect((root.querySelector('.nx-powered') as HTMLElement).hidden).toBe(true);
  });

  it('keeps the "Powered by" footer when the mint says the workspace is not entitled, even if the URL asked to hide it', async () => {
    stubFetchWithPoweredBy(true);
    const root = mountWith('?organization_id=org-1&powered_by=0');
    openPanel(root);
    // Wait for the mint's nested state fetch — proof `mint()` reached the point
    // where it would have applied the API's appearance — before asserting the
    // negative (a too-early check would pass even if apply were never called).
    await waitFor(() => calls.some((u) => u.includes('/customer/chat')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((root.querySelector('.nx-powered') as HTMLElement).hidden).toBe(false);
  });
});
