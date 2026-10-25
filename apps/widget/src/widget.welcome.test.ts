/**
 * The workspace's welcome message (owner, 2026-10-13).
 *
 * Written in Settings -> Widget, delivered by the token mint (never by the
 * snippet), and shown in the two places a visitor meets the team first: the
 * pre-chat form's opening bubble and the top of the conversation. The text is
 * the workspace's, but it lands in a stranger's browser, so the tests that
 * matter most are the ones about what it can *not* do — carry markup, or link
 * anywhere but an http(s) address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

/** Every widget this file mounts, taken down after each test (`mount` returns its teardown). */
const mounted: Array<() => void> = [];

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

let welcome: { welcome_title?: string | null; welcome_text?: string | null } = {};

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          widget: {
            primary_color: '#2d67fa',
            position: 'bottom-right',
            theme: 'light',
            mobile_fullscreen: true,
            powered_by: true,
            ...welcome,
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

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', '/widget.html?organization_id=org-1&api=https://api.test/v1');
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mounted.push(mount(document, window));
  return root;
}

const intro = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>('.nx-prechat-intro')!;
const transcriptWelcome = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>('.nx-welcome')!;

/** Open into the pre-chat form, as "Let's chat" does, and wait for the mint. */
async function openAndMint(root: HTMLElement): Promise<void> {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(() => {
  welcome = {};
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubFetch();
});

afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('widget welcome message', () => {
  it('keeps the built-in line, and adds nothing to the conversation, when none is set', async () => {
    const root = mountWidget();
    await openAndMint(root);

    expect(intro(root).textContent).toBe('Tell us who you are and we will get started.');
    expect(transcriptWelcome(root).hidden).toBe(true);
  });

  it('shows the workspace title in bold over its text, in both places', async () => {
    welcome = { welcome_title: 'Welcome to Acme!', welcome_text: 'Good to see you here.' };
    const root = mountWidget();
    await openAndMint(root);

    for (const host of [intro(root), transcriptWelcome(root)]) {
      expect(host.querySelector('strong.nx-welcome-title')!.textContent).toBe('Welcome to Acme!');
      expect(host.querySelector('.nx-welcome-text')!.textContent).toBe('Good to see you here.');
    }
    expect(transcriptWelcome(root).hidden).toBe(false);
  });

  it('turns [label](https://…) into a link that opens in a new tab', async () => {
    welcome = { welcome_text: 'All our stores are [listed here](https://acme.example/stores).' };
    const root = mountWidget();
    await openAndMint(root);

    const link = intro(root).querySelector<HTMLAnchorElement>('a.nx-welcome-link')!;
    expect(link.textContent).toBe('listed here');
    expect(link.href).toBe('https://acme.example/stores');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(intro(root).textContent).toBe('All our stores are listed here.');
  });

  it('never links anywhere but http(s), and never parses markup', async () => {
    welcome = {
      welcome_text: 'Click [me](javascript:alert(1)) or <img src=x onerror=alert(1)>',
    };
    const root = mountWidget();
    await openAndMint(root);

    // The unsafe link stays as the literal text it was typed as.
    expect(intro(root).querySelector('a')).toBeNull();
    expect(intro(root).querySelector('img')).toBeNull();
    expect(intro(root).textContent).toContain('[me](javascript:alert(1))');
    expect(intro(root).textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
