/**
 * Launcher visibility and the brand logo (WG-10 · tm 347).
 *
 * The bubble is drawn from a mode the server gives (`always` / `until_opened` /
 * `never`), never from the install snippet. A first-time visitor is not minted
 * for, so the mode comes from a small lookup before any mint; what a browser
 * learned last time draws the bubble at once. Until the mode is known nothing is
 * drawn, so a bubble never flashes up and vanishes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

let calls: string[] = [];
let posted: Array<Record<string, unknown>> = [];

const onMessage = (event: MessageEvent): void => {
  if (typeof event.data?.type === 'string' && event.data.type.startsWith('siyahtus:')) {
    posted.push(event.data);
  }
};

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

const chatState = (events: unknown[] = []): Response =>
  jsonResponse({
    online: true,
    agent_typing: false,
    customer: { id: 'cust-1', name: null, email: null },
    agent: null,
    chat: null,
    events,
  });

/** The launcher lookup answers `mode` (null = the request fails); the mint carries `widget`. */
function stubFetch(
  mode: string | null,
  widget: Record<string, unknown> = {},
  events: unknown[] = [],
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/customer/launcher')) {
        if (mode === null) throw new Error('offline');
        return jsonResponse({ launcher_visibility: mode });
      }
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          widget: {
            primary_color: '#2d67fa',
            position: 'bottom-right',
            theme: 'auto',
            mobile_fullscreen: true,
            powered_by: true,
            ...widget,
          },
        });
      }
      return chatState(events);
    }),
  );
}

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', '/widget.html?organization_id=org-1');
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  return root;
}

const launcher = (root: HTMLElement): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('.nx-launcher')!;
const panel = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('.nx-panel')!;

function lastSize(): { width: number; height: number } | undefined {
  const sizes = posted.filter((m) => m['type'] === 'siyahtus:resize');
  return sizes[sizes.length - 1] as { width: number; height: number } | undefined;
}

/** What `siyahtus('open')` becomes by the time it reaches the widget document. */
function hostOpen(source: MessageEventSource | null = window.parent): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'siyahtus:command', command: 'open' }, source }),
  );
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
  posted = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.localStorage.clear();
  window.addEventListener('message', onMessage);
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  window.removeEventListener('message', onMessage);
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('widget launcher visibility (WG-10)', () => {
  it('draws nothing until the mode is known, then draws the launcher for always', async () => {
    stubFetch('always');
    const root = mountWidget();
    expect(launcher(root).hidden).toBe(true);
    await waitFor(() => !launcher(root).hidden);
    expect(calls.some((url) => url.includes('/customer/launcher?organization_id=org-1'))).toBe(
      true,
    );
    // A first-time visitor is not minted for.
    expect(calls.some((url) => url.includes('/customer/token'))).toBe(false);
    expect(window.localStorage.getItem('siyahtus.launcher.org-1')).toBe('always');
  });

  it('keeps the launcher away on until_opened and gives the corner back to the page', async () => {
    stubFetch('until_opened');
    const root = mountWidget();
    await waitFor(() => calls.some((url) => url.includes('/customer/launcher')));
    await waitFor(() => lastSize()?.width === 0);
    expect(launcher(root).hidden).toBe(true);
    expect(lastSize()).toMatchObject({ width: 0, height: 0 });
  });

  it("siyahtus('open') opens the panel on until_opened and shows the launcher from then on", async () => {
    stubFetch('until_opened');
    const root = mountWidget();
    await waitFor(() => lastSize()?.width === 0);
    hostOpen();
    expect(panel(root).hidden).toBe(false);
    expect(launcher(root).hidden).toBe(false);
    await waitFor(() => (lastSize()?.width ?? 0) > 0);
    // Closed again, the launcher stays.
    launcher(root).click();
    expect(panel(root).hidden).toBe(true);
    expect(launcher(root).hidden).toBe(false);
  });

  it('never draws a launcher on never; the panel opens through the API and closes on its own ×', async () => {
    stubFetch('never');
    const root = mountWidget();
    await waitFor(() => lastSize()?.width === 0);
    expect(launcher(root).hidden).toBe(true);
    hostOpen();
    expect(panel(root).hidden).toBe(false);
    expect(launcher(root).hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('.nx-close')!.click();
    expect(panel(root).hidden).toBe(true);
    expect(launcher(root).hidden).toBe(true);
    expect(lastSize()).toMatchObject({ width: 0, height: 0 });
  });

  it('ignores an open command that does not come from the embedding page', async () => {
    stubFetch('never');
    const root = mountWidget();
    await waitFor(() => lastSize()?.width === 0);
    hostOpen(null);
    expect(panel(root).hidden).toBe(true);
  });

  it('draws from what the browser learned last time, before any answer', () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'always');
    stubFetch('never');
    expect(launcher(mountWidget()).hidden).toBe(false);
  });

  it('follows a changed setting as soon as the answer arrives', async () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'always');
    stubFetch('never');
    const root = mountWidget();
    await waitFor(() => launcher(root).hidden);
    expect(window.localStorage.getItem('siyahtus.launcher.org-1')).toBe('never');
  });

  it('draws the launcher when the lookup fails and nothing is remembered', async () => {
    stubFetch(null);
    const root = mountWidget();
    await waitFor(() => !launcher(root).hidden);
  });

  it('takes the mode from the mint too', async () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'always');
    stubFetch('always', { launcher_visibility: 'never' });
    const root = mountWidget();
    launcher(root).click();
    await waitFor(() => launcher(root).hidden);
    expect(window.localStorage.getItem('siyahtus.launcher.org-1')).toBe('never');
  });

  it('tells the host page the unread count — the number and nothing else', async () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'never');
    window.localStorage.setItem('siyahtus.customer_id.org-1', 'cust-1');
    stubFetch('never', {}, [
      {
        id: 'e1',
        text: 'secret reply',
        author_type: 'agent',
        created_at: '2026-09-05T10:00:02.000Z',
        type: 'message',
        attachment_url: null,
      },
    ]);
    mountWidget();
    await waitFor(() => posted.some((m) => m['type'] === 'siyahtus:unread'));
    expect(posted.find((m) => m['type'] === 'siyahtus:unread')).toEqual({
      type: 'siyahtus:unread',
      count: 1,
    });
  });
});

describe('widget brand logo (WG-10)', () => {
  it('shows the brand logo in the header with the brand name as its alt text', async () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'always');
    stubFetch('always', { logo_url: 'https://cdn.example.com/logo.png', brand_name: 'Acme' });
    const root = mountWidget();
    const logo = root.querySelector<HTMLImageElement>('.nx-logo')!;
    expect(logo.hidden).toBe(true);
    launcher(root).click();
    await waitFor(() => !logo.hidden);
    expect(logo.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    expect(logo.alt).toBe('Acme');
  });

  it('shows no logo when the mint carries none', async () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'always');
    stubFetch('always');
    const root = mountWidget();
    launcher(root).click();
    await waitFor(() => calls.some((url) => url.includes('/customer/chat')));
    expect(root.querySelector<HTMLImageElement>('.nx-logo')!.hidden).toBe(true);
  });

  it('hides a logo that fails to load rather than leave a broken image', async () => {
    window.localStorage.setItem('siyahtus.launcher.org-1', 'always');
    stubFetch('always', { logo_url: 'https://cdn.example.com/gone.png', brand_name: 'Acme' });
    const root = mountWidget();
    const logo = root.querySelector<HTMLImageElement>('.nx-logo')!;
    launcher(root).click();
    await waitFor(() => !logo.hidden);
    logo.dispatchEvent(new Event('error'));
    expect(logo.hidden).toBe(true);
  });
});
