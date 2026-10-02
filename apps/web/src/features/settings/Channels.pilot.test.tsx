/**
 * Settings → Channels in the public pilot (tm 257.3 · ADR
 * docs/adr/pilot-public-readiness.md K-d): the grid is Website and Chat page,
 * `GET /channels` is never asked (a 403 there would blank those two cards with
 * the rest of the grid), and the six names of the cards that went are no
 * longer search terms. Each is paired with the same owner on an ordinary
 * deployment; the flag-off grid `Channels.test.tsx` and `channels.test.ts` pin
 * is left to them, unchanged.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES, type DeploymentConfig } from '@siyahtus/types';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';
import { settings as EN_SETTINGS } from '../../locales/en/settings.js';
import { channelsFor } from './Channels.js';
import { searchSections, type SettingsSectionEntry } from './settings-sections.js';

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const { ChannelsGrid } = await import('./Channels.js');

const OWNER = [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES];
const PILOT: DeploymentConfig = {
  pilot_mode: true,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
};
const ORDINARY: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
};

const englishLabel = (section: SettingsSectionEntry): string =>
  EN_SETTINGS[section.labelKey] ?? section.labelKey;

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** `/channels` answers a 403 like the API would if it refused reads — it must not matter in the pilot. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/channels')) return okJson({ items: [] });
    if (String(url).includes('/websites')) return okJson({ items: [] });
    return okJson({ items: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderGrid(config: DeploymentConfig): void {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChannelsGrid />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const urlsAsked = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
  fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'agent-1',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
      organization_id: 'org-1',
      license_id: 'license-1',
      scopes: ['channels--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
  useBrandStore.setState({ brandId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('channelsFor in the public pilot (tm 257.3)', () => {
  it('is the Website and Chat page cards, in that order', () => {
    expect(channelsFor([], [], true).map((c) => c.id)).toEqual(['website', 'chat-page']);
  });

  it('keeps the Website card tracking the sites, even with a stale connected adapter row', () => {
    const cards = channelsFor(
      [{ status: 'connected' }],
      [{ type: 'messenger', connected: true } as never],
      true,
    );
    expect(cards.map((c) => c.id)).toEqual(['website', 'chat-page']);
    expect(cards[0]).toMatchObject({ status: 'connected', cta: 'Manage' });
  });

  it('is all eight cards otherwise, as before', () => {
    expect(channelsFor([], []).map((c) => c.id)).toEqual([
      'website',
      'chat-page',
      'email',
      'messenger',
      'whatsapp',
      'sms',
      'instagram',
      'telegram',
    ]);
  });
});

describe('ChannelsGrid in the public pilot (tm 257.3)', () => {
  it('shows the Website and Chat page cards and no other', async () => {
    stubFetch();
    renderGrid(PILOT);

    expect(await screen.findByTestId('channel-website')).toBeInTheDocument();
    expect(screen.getByTestId('channel-chat-page')).toBeInTheDocument();
    for (const id of ['email', 'messenger', 'whatsapp', 'sms', 'instagram', 'telegram']) {
      expect(screen.queryByTestId(`channel-${id}`)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/\(mock\)/)).not.toBeInTheDocument();
  });

  it('never asks for GET /channels — the grid does not wait on, or fail with, a list it does not show', async () => {
    const fetchMock = stubFetch();
    renderGrid(PILOT);

    await screen.findByTestId('channel-website');
    expect(urlsAsked(fetchMock).some((url) => url.includes('/channels'))).toBe(false);
    expect(urlsAsked(fetchMock).some((url) => url.includes('/websites'))).toBe(true);
  });

  it('keeps the Chat page link, which is the real address of the hosted page', async () => {
    stubFetch();
    renderGrid(PILOT);

    const card = await screen.findByTestId('channel-chat-page');
    expect(card).toHaveTextContent('Get link');
    expect(screen.getByTestId('chat-page-url')).toHaveTextContent(
      '/chat.html?organization_id=org-1',
    );
  });

  it('shows all eight cards, and asks for GET /channels, on an ordinary deployment', async () => {
    const fetchMock = stubFetch();
    renderGrid(ORDINARY);

    expect(await screen.findByTestId('channel-messenger')).toBeInTheDocument();
    for (const id of [
      'website',
      'chat-page',
      'email',
      'whatsapp',
      'sms',
      'instagram',
      'telegram',
    ]) {
      expect(screen.getByTestId(`channel-${id}`)).toBeInTheDocument();
    }
    expect(urlsAsked(fetchMock).some((url) => url.includes('/channels'))).toBe(true);
  });
});

describe('settings search in the public pilot (tm 257.3)', () => {
  const hits = (query: string, pilotMode: boolean): string[] =>
    searchSections(OWNER, query, englishLabel, pilotMode).map((s) => s.slug);

  it('does not point "whatsapp" and the five other dropped names at Channels', () => {
    for (const query of ['messenger', 'whatsapp', 'sms', 'telegram', 'instagram', 'email']) {
      expect(hits(query, true)).not.toContain('channels');
    }
  });

  it('still finds Channels by its own name, and by those names on an ordinary deployment', () => {
    expect(hits('channels', true)).toContain('channels');
    for (const query of ['messenger', 'whatsapp', 'sms', 'telegram', 'instagram', 'email']) {
      expect(hits(query, false)).toContain('channels');
    }
  });
});
