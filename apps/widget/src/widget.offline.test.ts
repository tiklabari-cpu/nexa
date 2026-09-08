/**
 * Offline form (FR-MOD-08.7.7, the "ticket/prospect" half of "Forms builder
 * (pre-chat/post-chat/ticket/prospect)"): when nobody is available, the widget
 * offers a message that opens a *ticket* instead of a composer nobody is behind.
 *
 * Two forms are asked on that one screen and they go to two different places —
 * `ticket_form` questions are about the request and land on the ticket,
 * `prospect_form` ones are about the person and land on the contact — so the
 * widget keeps them in two hosts and posts them under two keys. Both arrive with
 * the token mint, for the post-chat form's reason: the widget makes no second
 * fetch, and whether anybody is available is only known once a poll lands.
 *
 * The panel is opt-in on this side too: a workspace that has built neither form
 * gets exactly the widget it had before this existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetFormField } from '@nexa/types';
import { mount } from './widget.js';

const API = 'https://api.test/v1';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let calls: FetchCall[] = [];
/** What the mint reports as the workspace's two offline forms. */
let ticketForm: WidgetFormField[] = [];
let prospectForm: WidgetFormField[] = [];
/** Whether the poll says an agent is available. */
let online = false;
/** `/customer/ticket` responds with this — 400 exercises the failure path. */
let leaveStatus = 201;

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/customer/token')) {
        return jsonResponse({
          token: 'tok',
          customer_id: 'cust-1',
          pre_chat_form: [],
          post_chat_form: [],
          ticket_form: ticketForm,
          prospect_form: prospectForm,
        });
      }
      if (url.includes('/customer/ticket')) {
        return jsonResponse(
          leaveStatus < 300 ? { ticket_id: 'TCK-1' } : { error: { message: 'nope' } },
          leaveStatus,
        );
      }
      if (url.endsWith('/customer/chat')) {
        return jsonResponse({
          online,
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
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1&api=${API}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

function openPanel(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
}

/**
 * Wait until the mint has landed and the panel body has been decided.
 *
 * The state poll is the signal because it is the request that carries `online`
 * — the fact the decision turns on. The renders run synchronously once its
 * response resolves, so two turns of the event loop are comfortably after them;
 * this matters for the assertions below that something is *absent*, which would
 * otherwise pass before the widget had decided anything.
 */
async function settled(): Promise<void> {
  await vi.waitFor(() =>
    expect(calls.some((c) => c.url.endsWith('/customer/chat') && c.method === 'GET')).toBe(true),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function leaveCalls(): FetchCall[] {
  return calls.filter((c) => c.url.includes('/customer/ticket'));
}

function fill(root: HTMLElement, selector: string, value: string): void {
  root.querySelector<HTMLInputElement>(selector)!.value = value;
}

beforeEach(() => {
  calls = [];
  online = false;
  leaveStatus = 201;
  ticketForm = [
    { definition_id: 'f-order', label: 'Affected order', type: 'text', required: true },
    { definition_id: 'f-total', label: 'Order total', type: 'number', required: false },
  ];
  prospectForm = [{ definition_id: 'f-company', label: 'Company', type: 'text', required: false }];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('widget offline form (FR-MOD-08.7.7)', () => {
  it('replaces the composer when nobody is available, with one input per configured field', async () => {
    const root = mountWidget();
    openPanel(root);
    await settled();

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false),
    );
    // Two doors, one of which nobody is behind, is not an offer worth making.
    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(true);

    const form = root.querySelector<HTMLFormElement>('.nx-offline')!;
    const hosts = form.querySelectorAll<HTMLElement>('.nx-prechat-fields');
    // Prospect questions first — who they are — then the ones about the request.
    expect(
      Array.from(hosts[0]!.querySelectorAll<HTMLInputElement>('input[data-def-id]')).map(
        (el) => el.dataset['defId'],
      ),
    ).toEqual(['f-company']);
    expect(
      Array.from(hosts[1]!.querySelectorAll<HTMLInputElement>('input[data-def-id]')).map(
        (el) => el.dataset['defId'],
      ),
    ).toEqual(['f-order', 'f-total']);
  });

  it('stays away entirely while an agent is available', async () => {
    online = true;
    const root = mountWidget();
    openPanel(root);
    await settled();

    expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(false);
  });

  it('stays away when the workspace has built neither form, offline or not', async () => {
    // Opt-in: without questions there is no form, and the widget is exactly the
    // one it was before this existed — an offline visitor still gets the
    // composer and the "nobody is available" status line.
    ticketForm = [];
    prospectForm = [];
    const root = mountWidget();
    openPanel(root);
    await settled();

    expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(false);
  });

  it('posts the two forms under their own keys and swaps the panel for a thank-you', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false),
    );

    const form = root.querySelector<HTMLFormElement>('.nx-offline')!;
    fill(root, '.nx-offline input[type="text"]', 'My order never arrived');
    fill(root, 'input[data-def-id="f-order"]', 'ORD-42');
    fill(root, 'input[data-def-id="f-company"]', 'Acme Ltd');
    root.querySelectorAll<HTMLInputElement>('.nx-offline input[type="text"]')[1]!.value = 'Dana';
    fill(root, '.nx-offline input[type="email"]', 'dana@example.com');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(leaveCalls()).toHaveLength(1));
    expect(leaveCalls()[0]!.method).toBe('POST');
    // Each answer travels under the heading of the form it was asked on — the
    // server judges each map against its own placement, so a question about the
    // person can never be stored as an answer about the request.
    expect(leaveCalls()[0]!.body).toEqual({
      subject: 'My order never arrived',
      name: 'Dana',
      email: 'dana@example.com',
      ticket_fields: { 'f-order': 'ORD-42' },
      prospect_fields: { 'f-company': 'Acme Ltd' },
    });

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline-thanks')!.hidden).toBe(false),
    );
    // The answers are gone from the DOM once they are safely stored.
    expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(true);
  });

  it('sends nothing while a required question is unanswered', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false),
    );

    const form = root.querySelector<HTMLFormElement>('.nx-offline')!;
    fill(root, '.nx-offline input[type="text"]', 'Hello');
    fill(root, '.nx-offline input[type="email"]', 'dana@example.com');
    // `f-order` is required and left blank.
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(leaveCalls()).toHaveLength(0);
    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>('input[data-def-id="f-order"]'),
    );
  });

  it('sends nothing without an e-mail — this message is answered nowhere else', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false),
    );

    const form = root.querySelector<HTMLFormElement>('.nx-offline')!;
    fill(root, '.nx-offline input[type="text"]', 'Hello');
    fill(root, 'input[data-def-id="f-order"]', 'ORD-42');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(leaveCalls()).toHaveLength(0);
    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>('.nx-offline input[type="email"]'),
    );
  });

  it('surfaces a rejected submit and keeps what the visitor typed on screen', async () => {
    leaveStatus = 400;
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false),
    );

    const form = root.querySelector<HTMLFormElement>('.nx-offline')!;
    fill(root, '.nx-offline input[type="text"]', 'My order never arrived');
    fill(root, '.nx-offline input[type="email"]', 'dana@example.com');
    fill(root, 'input[data-def-id="f-order"]', 'ORD-42');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(leaveCalls()).toHaveLength(1));
    // Telling a visitor their message was received when it was not is the one
    // outcome this screen must never produce.
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline .nx-postchat-error')!.hidden).toBe(false),
    );
    expect(root.querySelector<HTMLElement>('.nx-offline-thanks')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false);
    expect(root.querySelector<HTMLInputElement>('input[data-def-id="f-order"]')!.value).toBe(
      'ORD-42',
    );
  });

  it('gives the composer back when an agent comes online mid-visit', async () => {
    const root = mountWidget();
    openPanel(root);
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(false),
    );

    // Availability is a poll-to-poll fact, so the choice is re-made on each one.
    online = true;
    await vi.waitFor(
      () => {
        expect(root.querySelector<HTMLElement>('.nx-offline')!.hidden).toBe(true);
        expect(root.querySelector<HTMLElement>('.nx-form')!.hidden).toBe(false);
      },
      { timeout: 8000 },
    );
  }, 12_000);
});
