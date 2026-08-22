/**
 * The rail's presence group (FR-MOD-01.1.4).
 *
 * `fetch` is stubbed rather than the query cache seeded, because two of the
 * things worth proving are about the request itself: that the roster is read
 * from the shared `['agents']` key (one fetch for the whole app), and that a
 * refused read degrades to no group rather than to a broken rail.
 *
 * The live half is asserted through `applyPush` — the RTM push router — since
 * that is the only way a `routing_status_set` reaches this component, and
 * asserting it here rather than only in the inbox's own suite is what ties the
 * push to the thing on screen that changed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceAvatars } from './PresenceAvatars.js';
import { useAuth } from '../lib/auth-store.js';
import { useLocaleStore } from '../lib/i18n.js';
import { applyPush } from '../features/inbox/useInbox.js';

type Status = 'accepting_chats' | 'not_accepting_chats' | 'offline';

function member(id: string, name: string, routingStatus: Status) {
  return {
    id,
    name,
    email: `${id}@acme.localhost`,
    avatar_url: null,
    role: 'agent',
    routing_status: routingStatus,
    concurrent_chats_limit: 6,
  };
}

const SAM = member('a-2', 'Sam Rivera', 'accepting_chats');
const RIA = member('a-3', 'Ria Nakamura', 'not_accepting_chats');
const TOM = member('a-4', 'Tom Bright', 'accepting_chats');
const NEO = member('a-5', 'Neo Adeyemi', 'accepting_chats');
const IVY = member('a-6', 'Ivy Sorensen', 'accepting_chats');
const OFF = member('a-7', 'Zed Offline', 'offline');

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function forbidden(): Response {
  return {
    ok: false,
    status: 403,
    headers: { get: () => null },
    json: async () => ({
      error: { type: 'authorization', message: 'Not allowed.', request_id: '-' },
    }),
  } as unknown as Response;
}

/** Every request answers with this roster; the call count is asserted separately. */
function stubRoster(items: unknown[]) {
  const fetchMock = vi.fn(async () => jsonResponse({ items }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPresence(
  pinned = false,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const view = render(
    <QueryClientProvider client={client}>
      <PresenceAvatars pinned={pinned} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
  useLocaleStore.setState({ locale: 'en' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('presence avatars', () => {
  it('shows an online teammate with their name and status in the accessible name', async () => {
    stubRoster([SAM]);
    renderPresence();

    const avatar = await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });
    // The hover name the acceptance criterion asks for is the same string.
    expect(avatar).toHaveAttribute('title', 'Sam Rivera — accepting chats');
    expect(screen.getByRole('list', { name: 'Teammates online' })).toBeInTheDocument();
  });

  it('distinguishes away from accepting by a glyph, not only by ring colour', async () => {
    // NFR-A11Y2: two states are on screen at once, and green-vs-amber is not a
    // difference a colour-blind agent can see. The glyph and the accessible
    // name are the two signals that survive without colour.
    stubRoster([SAM, RIA]);
    const { container } = renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });
    expect(
      screen.getByRole('img', { name: 'Ria Nakamura — online, not accepting chats' }),
    ).toBeInTheDocument();

    const glyphs = Array.from(container.querySelectorAll('[aria-hidden="true"]')).map(
      (node) => node.textContent,
    );
    expect(glyphs).toEqual(['●', '◐']);
  });

  it('leaves offline teammates and the signed-in agent out of the group', async () => {
    // Dana is the account trigger directly below this group in the rail; a
    // second copy of her own face would say nothing.
    stubRoster([member('a-1', 'Dana Okonkwo', 'accepting_chats'), SAM, OFF]);
    renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });
    expect(screen.queryByRole('img', { name: /Dana Okonkwo/ })).toBeNull();
    expect(screen.queryByRole('img', { name: /Zed Offline/ })).toBeNull();
  });

  it('collapses the tail into a +N that still names who it stands for', async () => {
    stubRoster([SAM, RIA, TOM, NEO, IVY]);
    renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });
    const overflow = screen.getByRole('img', { name: '1 more online: Ivy Sorensen' });
    expect(overflow).toHaveTextContent('+1');
    expect(overflow).toHaveAttribute('title', 'Ivy Sorensen');
    // Only the first four faces are drawn; the fifth is behind the +1.
    expect(screen.queryByRole('img', { name: /Ivy Sorensen —/ })).toBeNull();
  });

  it('renders nothing at all when no teammate is online', async () => {
    const fetchMock = stubRoster([OFF]);
    const { container } = renderPresence();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the roster read is refused', async () => {
    // An ordinary agent whose token the route turns down must get a rail that
    // is short one group, not a rail that fails — the trial banner's shape.
    const fetchMock = vi.fn(async () => forbidden());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderPresence();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the roster from the shared agents key', async () => {
    // The ticket pane's follower picker uses the same key, so the app makes one
    // request for the roster rather than one per consumer.
    stubRoster([SAM]);
    const { client } = renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });
    expect(client.getQueryData(['agents'])).toEqual({ items: [SAM] });
  });

  it('goes live on a routing_status_set push, without refetching', async () => {
    // The whole reason the push is folded into the cache instead of triggering
    // an invalidation: it already carries the new value.
    const fetchMock = stubRoster([SAM]);
    const { client } = renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });
    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      applyPush(client, 'routing_status_set', { agent_id: 'a-2', status: 'not_accepting_chats' });
    });

    expect(
      await screen.findByRole('img', { name: 'Sam Rivera — online, not accepting chats' }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('drops the last teammate off the rail when they go offline', async () => {
    stubRoster([SAM]);
    const { client, container } = renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });

    act(() => {
      applyPush(client, 'routing_status_set', { agent_id: 'a-2', status: 'offline' });
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('ignores a malformed or unknown-status push rather than corrupting the group', async () => {
    stubRoster([SAM]);
    const { client } = renderPresence();

    await screen.findByRole('img', { name: 'Sam Rivera — accepting chats' });

    act(() => {
      applyPush(client, 'routing_status_set', { agent_id: 'a-2', status: 'on_a_break' });
      applyPush(client, 'routing_status_set', { agent_id: 42, status: 'offline' });
      applyPush(client, 'routing_status_set', {});
    });

    expect(screen.getByRole('img', { name: 'Sam Rivera — accepting chats' })).toBeInTheDocument();
  });

  it('translates the group with the rest of the console', async () => {
    useLocaleStore.setState({ locale: 'tr' });
    stubRoster([SAM]);
    renderPresence();

    expect(
      await screen.findByRole('img', { name: 'Sam Rivera — sohbet kabul ediyor' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Çevrimiçi ekip arkadaşları' })).toBeInTheDocument();
  });
});
