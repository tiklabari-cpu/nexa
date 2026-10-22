/**
 * "Your support number" (ID-05 · ID-05-S1): the header "⋮" menu names the
 * conversation's Chat ID — the connection the agent has open, the one the panel
 * shows as "Chat ID" — and copies it, so the player can quote the very number
 * the team searches for. Only that number: the day's Thread ID stays on the
 * agents' side.
 *
 * The number comes from the snapshot the widget already polls (`chat.thread_id`);
 * nothing is derived. Where the browser refuses the clipboard, the number is
 * selected instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** What `GET /customer/chat` answers; swapped by a test to move to a new connection. */
let chat: { id: string; thread_id: string } | null = { id: 'TJ1H8CFKRV', thread_id: 'K3M9Q2XW7B' };

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/customer/token')) {
        return jsonResponse({ token: 'tok', customer_id: 'cust-1', pre_chat_form: [] });
      }
      if (url.endsWith('/customer/chat')) {
        return jsonResponse({
          online: true,
          agent_typing: false,
          customer: { id: 'cust-1', name: null, email: null },
          agent: null,
          chat: chat ? { ...chat, queue_position: null } : null,
          events: [],
        });
      }
      return jsonResponse({});
    }),
  );
}

function mountWidget(): HTMLElement {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

async function openMenu(root: HTMLElement): Promise<void> {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(false),
  );
  root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
}

beforeEach(() => {
  chat = { id: 'TJ1H8CFKRV', thread_id: 'K3M9Q2XW7B' };
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('widget "Your support number" (ID-05)', () => {
  it("names the open connection's number, not the day's, and copies exactly it", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const root = mountWidget();
    await openMenu(root);

    const support = root.querySelector<HTMLElement>('.nx-menu-support')!;
    expect(support.hidden).toBe(false);
    expect(support.textContent).toContain('Your support number');
    expect(root.querySelector('.nx-menu-support-id')?.textContent).toBe('K3M9Q2XW7B');
    expect(support.textContent).not.toContain('TJ1H8CFKRV');

    root.querySelector<HTMLButtonElement>('.nx-menu-copy')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('K3M9Q2XW7B'));
    expect(writeText).toHaveBeenCalledTimes(1);
    // The confirmation is the item's own label, and the menu stays open for it.
    await vi.waitFor(() =>
      expect(root.querySelector('.nx-menu-copy')?.textContent).toContain('Copied'),
    );
    expect(root.querySelector<HTMLElement>('.nx-menu')!.hidden).toBe(false);
  });

  it("shows the next connection's number when the same day gets a new one", async () => {
    const root = mountWidget();
    await openMenu(root);
    expect(root.querySelector('.nx-menu-support-id')?.textContent).toContain('K3M9Q2XW7B');

    chat = { id: 'TJ1H8CFKRV', thread_id: 'P4R6T8V0ZZ' };
    // The poll picks the new snapshot up; reopening the menu draws it.
    await vi.waitFor(
      () => {
        root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
        root.querySelector<HTMLButtonElement>('.nx-menu-btn')!.click();
        expect(root.querySelector('.nx-menu-support-id')?.textContent).toContain('P4R6T8V0ZZ');
      },
      { timeout: 8_000 },
    );
  });

  it('selects the number when the browser will not write to the clipboard', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const root = mountWidget();
    await openMenu(root);

    root.querySelector<HTMLButtonElement>('.nx-menu-copy')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    await vi.waitFor(() => expect(window.getSelection()?.toString()).toBe('K3M9Q2XW7B'));
    // Nothing was copied, so nothing says it was.
    expect(root.querySelector('.nx-menu-copy')?.textContent).toContain('Copy support number');
  });

  it('offers nothing before a connection exists', async () => {
    chat = null;
    const root = mountWidget();
    root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
    // No conversation: the whole "⋮" menu is hidden, and so is the number with it.
    await vi.waitFor(() => expect(root.querySelector('.nx-menu-wrap')).not.toBeNull());
    expect(root.querySelector<HTMLElement>('.nx-menu-wrap')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-menu-support')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-menu-copy')!.hidden).toBe(true);
  });
});
