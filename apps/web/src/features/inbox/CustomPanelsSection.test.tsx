/**
 * Custom panels in the Details pane (KN-05 · K29 · tm 379): the frame is
 * sandboxed without `allow-same-origin`, its address carries only a nonce, a
 * `ready` from the frame gets the token back, and a message from anywhere
 * else does nothing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { CUSTOM_PANEL_SANDBOX } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { useCopilotDraftStore } from './copilotDraft.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { CustomPanelsSection } = await import('./CustomPanelsSection.js');

const PANEL = {
  id: 'panel-1',
  name: 'Player card',
  url: 'https://bo.example/card?view=1',
  origin: 'https://bo.example',
};
const LATER = new Date(Date.now() + 5 * 60_000).toISOString();

function renderSection(ui: ReactElement): { container: HTMLElement } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

async function frame(): Promise<{ iframe: HTMLIFrameElement; channel: string }> {
  const iframe = (await screen.findByTitle('Player card (custom panel)')) as HTMLIFrameElement;
  const channel = new URL(iframe.getAttribute('src')!).hash.split('=')[1]!;
  return { iframe, channel };
}

function post(data: unknown, init: { source: MessageEventSource | null; origin: string }): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, ...init }));
  });
}

describe('custom panels in the Details pane', () => {
  beforeEach(() => {
    api.get.mockImplementation((path: string) => {
      if (path === '/chats/CHAT1/panels') return Promise.resolve({ items: [PANEL] });
      throw new Error(`unexpected GET ${path}`);
    });
    api.post.mockResolvedValue({ token: 'h.b.s', expires_at: LATER, delivery: 'frame' });
    useCopilotDraftStore.setState({ byChat: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('frames the page sandboxed, without allow-same-origin, with only a nonce in its address', async () => {
    renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    const { iframe, channel } = await frame();
    expect(iframe.getAttribute('sandbox')).toBe(CUSTOM_PANEL_SANDBOX);
    expect(iframe.getAttribute('sandbox')).not.toMatch(/allow-same-origin|allow-top-navigation/);
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('src')).toBe(`${PANEL.url}#siyahtus_channel=${channel}`);
    expect(channel).toMatch(/^[0-9a-f]{32}$/);
    expect(screen.getByText('Opens https://bo.example')).toBeInTheDocument();
  });

  it('answers the frame’s ready with the token, to the frame only, and reuses it on a second ready', async () => {
    renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    const { iframe, channel } = await frame();
    const sent = vi.spyOn(iframe.contentWindow!, 'postMessage');

    post({ type: 'siyahtus:ready', channel }, { source: iframe.contentWindow, origin: 'null' });
    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith(
        { type: 'siyahtus:context', channel, token: 'h.b.s', expires_at: LATER },
        '*',
      ),
    );
    expect(api.post).toHaveBeenCalledWith('/chats/CHAT1/panels/panel-1/context-token', {
      delivery: 'frame',
    });

    post({ type: 'siyahtus:ready', channel }, { source: iframe.contentWindow, origin: 'null' });
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a message from another origin, another window, or without the nonce', async () => {
    renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    const { iframe, channel } = await frame();
    const insert = { type: 'siyahtus:insert_text', channel, text: 'Bonus hesabınıza geçti.' };

    post(insert, { source: iframe.contentWindow, origin: 'https://evil.example' });
    post(insert, { source: window, origin: 'null' });
    post({ ...insert, channel: 'guess' }, { source: iframe.contentWindow, origin: 'null' });
    post({ type: 'siyahtus:ready', channel }, { source: window, origin: 'https://bo.example' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBeUndefined();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('puts a suggestion in the composer — never sends — and only on an open conversation', async () => {
    const view = renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    const { iframe, channel } = await frame();
    post(
      { type: 'siyahtus:insert_text', channel, text: 'Bakiyeniz güncel görünüyor.' },
      { source: iframe.contentWindow, origin: 'null' },
    );
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBe('Bakiyeniz güncel görünüyor.');
    expect(screen.getByRole('status')).toHaveTextContent('put a suggestion in the reply box');
    expect(api.post).not.toHaveBeenCalled();
    view.container.remove();

    useCopilotDraftStore.setState({ byChat: {} });
    renderSection(<CustomPanelsSection chatId="CHAT1" canInsert={false} />);
    const closed = (await screen.findAllByTitle('Player card (custom panel)')).at(
      -1,
    ) as HTMLIFrameElement;
    const closedChannel = new URL(closed.getAttribute('src')!).hash.split('=')[1]!;
    post(
      { type: 'siyahtus:insert_text', channel: closedChannel, text: 'Kapalı sohbet' },
      { source: closed.contentWindow, origin: 'null' },
    );
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBeUndefined();
  });

  it('resizes the frame within bounds', async () => {
    renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    const { iframe, channel } = await frame();
    post(
      { type: 'siyahtus:resize', channel, height: 520 },
      { source: iframe.contentWindow, origin: 'null' },
    );
    expect(iframe.style.height).toBe('520px');
    post(
      { type: 'siyahtus:resize', channel, height: 99_999 },
      { source: iframe.contentWindow, origin: 'null' },
    );
    expect(iframe.style.height).toBe('1200px');
  });

  it('opens a new tab with a link token in the fragment, the opener cut', async () => {
    const tab = { opener: window as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    api.post.mockResolvedValue({ token: 'l.i.k', expires_at: LATER, delivery: 'link' });
    renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    await frame();
    await userEvent.click(screen.getByRole('button', { name: 'Open in a new tab' }));
    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.href).toBe(`${PANEL.url}#siyahtus_token=l.i.k`));
    expect(tab.opener).toBeNull();
    expect(api.post).toHaveBeenCalledWith('/chats/CHAT1/panels/panel-1/context-token', {
      delivery: 'link',
    });
  });

  it('draws nothing when the conversation has no panel, or the answer is not one', async () => {
    api.get.mockResolvedValue({ items: [] });
    const empty = renderSection(<CustomPanelsSection chatId="CHAT1" canInsert />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(empty.container).toBeEmptyDOMElement();

    api.get.mockResolvedValue({ items: [{ ...PANEL, url: 'http://bo.example/' }, { id: 'x' }] });
    const odd = renderSection(<CustomPanelsSection chatId="CHAT2" canInsert />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chats/CHAT2/panels'));
    expect(odd.container.querySelector('iframe')).toBeNull();
  });
});
