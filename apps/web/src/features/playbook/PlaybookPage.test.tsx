/**
 * Playbook skill row — date + owner (FR-MOD-05.5).
 *
 * `serialiseSkill` already returned `updated_at`, and `created_by` was written
 * on create — but neither ever reached the skill row: the date was never
 * rendered, and the owner had no field to read from at all. Both are asserted
 * here against the rendered row itself, not just the payload shape, since a
 * field nobody reads is exactly how this gap in the PRD's row spec went
 * unnoticed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import type { Skill } from './types.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

function baseSkill(overrides: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill {
  return {
    ai_agent_id: null,
    kind: 'ai_agent',
    instruction: null,
    steps: [],
    active: true,
    runs_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_name: null,
    ...overrides,
  };
}

function mockPlaybook(skills: Skill[]): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: skills });
    if (path === '/ai-agents') return Promise.resolve({ items: [] });
    if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  // `agent` must be a real, stable object: `useAuth((s) => s.agent?.scopes ?? [])`
  // (the page's own scopes selector) mints a fresh `[]` on every call when
  // `agent` is nullish, which never satisfies zustand's snapshot equality and
  // spins into "Maximum update depth exceeded" — a test-only trap, not
  // something a signed-in app hits.
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
});

describe('Playbook skill row (FR-MOD-05.5)', () => {
  it("shows the skill's updated date and the account name that created it", async () => {
    mockPlaybook([
      baseSkill({
        id: 'skill-1',
        name: 'Order status',
        updated_at: '2026-01-15T10:00:00.000Z',
        created_by_name: 'Ada Lovelace',
      }),
    ]);
    renderPage();

    const row = (await screen.findByText('Order status')).closest('[role="listitem"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(formatDate('2026-01-15T10:00:00.000Z'));
    expect(row!.textContent).toContain('Ada Lovelace');
  });

  it('reads "—", never a raw account id, for a skill nobody authored', async () => {
    mockPlaybook([baseSkill({ id: 'skill-2', name: 'Seed skill', created_by_name: null })]);
    renderPage();

    const row = (await screen.findByText('Seed skill')).closest('[role="listitem"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('—');
    expect(row!.textContent).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
