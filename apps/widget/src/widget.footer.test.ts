/**
 * The widget footer's two links (FR-MOD-11.5, tm 257.17).
 *
 * "Powered by SiyahTuş" used to link to a reserved `.example` name written into
 * the widget bundle — a dead link on a public page. The address is now the
 * server's to send: a link when it sends one, plain words when it sends null
 * (the public pilot). Beside it, the deployment's privacy policy, which a
 * white-label workspace keeps even after it removes the brand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

interface Mint {
  powered_by?: boolean;
  privacy_policy_url?: string | null;
  powered_by_url?: string | null;
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

let chatPolls = 0;

function stubMint(links: Mint): void {
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
            theme: 'auto',
            mobile_fullscreen: true,
            powered_by: true,
            ...links,
          },
        });
      }
      if (url.includes('/customer/chat')) {
        chatPolls += 1;
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

/** Mounts, opens the panel and waits until the mint's appearance has been applied. */
async function mountAfterMint(): Promise<HTMLElement> {
  window.history.replaceState({}, '', '/widget.html?organization_id=org-1&language=en');
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() => expect(chatPolls).toBeGreaterThanOrEqual(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

const footer = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('.nx-powered')!;
const brandLink = (root: HTMLElement): HTMLAnchorElement | null =>
  root.querySelector<HTMLAnchorElement>('.nx-powered-brand a');
const privacyLink = (root: HTMLElement): HTMLAnchorElement =>
  root.querySelector<HTMLAnchorElement>('.nx-privacy-link')!;

beforeEach(() => {
  chatPolls = 0;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('widget footer links (FR-MOD-11.5)', () => {
  it('links the privacy policy the server names, in a new tab without opener', async () => {
    stubMint({ privacy_policy_url: 'https://legal.test/privacy', powered_by_url: null });
    const root = await mountAfterMint();

    const link = privacyLink(root);
    expect(link.hidden).toBe(false);
    expect(link.textContent).toBe('Privacy');
    expect(link.getAttribute('href')).toBe('https://legal.test/privacy');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('shows no privacy link when the server names none', async () => {
    stubMint({ privacy_policy_url: null, powered_by_url: null });
    const root = await mountAfterMint();
    expect(privacyLink(root).hidden).toBe(true);
    expect(privacyLink(root).hasAttribute('href')).toBe(false);
  });

  it('shows no privacy link when the mint predates the field', async () => {
    stubMint({});
    const root = await mountAfterMint();
    expect(privacyLink(root).hidden).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', '/relative', 'not a url'])(
    'refuses %s as a privacy address',
    async (bad) => {
      stubMint({ privacy_policy_url: bad });
      const root = await mountAfterMint();
      expect(privacyLink(root).hidden).toBe(true);
      expect(privacyLink(root).hasAttribute('href')).toBe(false);
    },
  );

  it('shows “Powered by” as plain words when the server sends no address', async () => {
    stubMint({ powered_by_url: null });
    const root = await mountAfterMint();

    expect(footer(root).hidden).toBe(false);
    expect(brandLink(root)).toBeNull();
    expect(root.querySelector('.nx-powered-brand')!.textContent).toBe('Powered by SiyahTuş');
  });

  it('links “Powered by” to the address the server sends', async () => {
    stubMint({ powered_by_url: 'https://brand.test/' });
    const root = await mountAfterMint();

    const link = brandLink(root)!;
    expect(link.textContent).toBe('Powered by SiyahTuş');
    expect(link.getAttribute('href')).toBe('https://brand.test/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('keeps the privacy link when white label removed the brand', async () => {
    stubMint({
      powered_by: false,
      powered_by_url: 'https://brand.test/',
      privacy_policy_url: 'https://legal.test/privacy',
    });
    const root = await mountAfterMint();

    expect(footer(root).hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.nx-powered-brand')!.hidden).toBe(true);
    expect(root.querySelector('.nx-powered-brand')!.textContent).toBe('');
    expect(privacyLink(root).hidden).toBe(false);
    // One thing left on the line, so no separator.
    expect(root.querySelector<HTMLElement>('.nx-powered-sep')!.hidden).toBe(true);
  });

  it('separates the two when both show', async () => {
    stubMint({ privacy_policy_url: 'https://legal.test/privacy', powered_by_url: null });
    const root = await mountAfterMint();
    expect(root.querySelector<HTMLElement>('.nx-powered-sep')!.hidden).toBe(false);
  });

  it('hides the whole line when there is neither brand nor privacy link', async () => {
    stubMint({ powered_by: false, privacy_policy_url: null });
    const root = await mountAfterMint();
    expect(footer(root).hidden).toBe(true);
  });

  it('carries no address of its own — before the mint it is words without a link', () => {
    window.history.replaceState({}, '', '/widget.html?organization_id=org-1&language=en');
    const root = document.createElement('div');
    root.id = 'siyahtus-widget-root';
    document.body.append(root);
    mount(document, window);

    expect(brandLink(root)).toBeNull();
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.includes('siyahtus.example'))).toEqual([]);
    expect(privacyLink(root).hidden).toBe(true);
  });
});
