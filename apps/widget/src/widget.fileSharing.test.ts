/**
 * The widget's attach button hides when the licence has file sharing
 * switched off (FR-MOD-08.9.4) — `apps/widget/src/widget.ts`'s side of the
 * same fix as `Composer.fileSharing.test.tsx` on the agent app: before this,
 * a visitor could always pick a file and only learn it was refused after
 * `POST /uploads` answered.
 *
 * `POST /customer/token` bundles `file_sharing_enabled` with the appearance
 * and the forms at mint (`auth.ts`'s `fileSharingEnabledFor`), so the widget
 * makes no second fetch for it either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', '/widget.html?organization_id=org-1');
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

let calls: string[] = [];

/** Stubs the token mint to report the licence's file-sharing switch. */
function stubFetch(fileSharingEnabled: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          file_sharing_enabled: fileSharingEnabled,
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

const attachButton = (root: HTMLElement): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('.nx-attach')!;

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
  window.localStorage.clear();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('widget attach button (FR-MOD-08.9.4)', () => {
  it('is on screen before the panel connects — the default the endpoint itself falls back to', () => {
    stubFetch(true);
    const root = mountWidget();
    expect(attachButton(root).hidden).toBe(false);
  });

  it('stays on screen once the mint confirms file sharing is on', async () => {
    stubFetch(true);
    const root = mountWidget();
    openPanel(root);
    // Wait for the mint's nested state fetch — proof `mint()` reached the
    // point where it would have applied the API's answer — before asserting
    // the positive (a too-early check would pass even if it were never set).
    await waitFor(() => calls.some((u) => u.includes('/customer/chat')));
    expect(attachButton(root).hidden).toBe(false);
  });

  it('hides once the mint reports file sharing switched off', async () => {
    stubFetch(false);
    const root = mountWidget();
    openPanel(root);
    await waitFor(() => attachButton(root).hidden);
    expect(attachButton(root).hidden).toBe(true);
    expect(calls.some((u) => u.includes('/customer/chat'))).toBe(true);
  });
});
