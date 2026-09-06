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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import type { Skill } from './types.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

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
  api.post.mockReset();
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

/**
 * The Knowledge panel's File source (FR-MOD-06.3.2).
 *
 * The gap this closes was not a missing widget but a missing *meaning*:
 * choosing "File" used to show the same textarea every other type shows, so a
 * file source was text somebody typed. These tests assert the two halves of the
 * fix — the form asks for bytes, and it sends them to the endpoint that judges
 * them — plus the refusal a real OS dialog makes reachable, since a person can
 * always override an `accept` filter.
 */
describe('Playbook knowledge — File source (FR-MOD-06.3.2)', () => {
  const AI_AGENT_ID = 'agent-1';

  function mockKnowledge(): void {
    api.get.mockImplementation((path: string) => {
      if (path === '/skills') return Promise.resolve({ items: [] });
      if (path === '/ai-agents')
        return Promise.resolve({
          items: [{ id: AI_AGENT_ID, kind: 'ai_agent', name: 'Ada', active: true }],
        });
      if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    useAuth.setState((state) => ({
      agent: state.agent ? { ...state.agent, scopes: ['agents-bot--all:rw'] } : state.agent,
    }));
  }

  async function openKnowledgeAsFile(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Knowledge' }));
    await user.selectOptions(await screen.findByLabelText('Type', { exact: true }), 'file');
  }

  it('asks for a file instead of a textarea once File is chosen', async () => {
    mockKnowledge();
    const user = userEvent.setup();
    await openKnowledgeAsFile(user);

    const input = await screen.findByLabelText('File');
    expect(input).toHaveAttribute('type', 'file');
    expect(screen.queryByLabelText('Content')).not.toBeInTheDocument();
    // Nothing picked yet, so there is nothing to upload.
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  it('uploads the picked file as bytes, defaulting the title to its name', async () => {
    mockKnowledge();
    api.post.mockResolvedValue({ id: 'src-1', type: 'file', chunk_count: 2 });
    const user = userEvent.setup();
    await openKnowledgeAsFile(user);

    const body = 'Items can be returned within 30 days.';
    await user.upload(
      await screen.findByLabelText('File'),
      new File([body], 'returns-policy.txt', { type: 'text/plain' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Add source' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/knowledge-sources/file', {
        ai_agent_id: AI_AGENT_ID,
        filename: 'returns-policy.txt',
        content_type: 'text/plain',
        data: expect.any(String),
      }),
    );
    // No `name` key at all rather than an empty one: the server's default is
    // the file's own name, which is a better title than ''.
    const payload = api.post.mock.calls[0]?.[1] as { name?: string; data: string };
    expect(payload).not.toHaveProperty('name');
    expect(Buffer.from(payload.data, 'base64').toString('utf8')).toBe(body);
  });

  it('rejects an unsupported file in the form and makes no network call', async () => {
    mockKnowledge();
    // `applyAccept: false`: an OS dialog still offers "All Files", so the
    // component's own precheck is what has to refuse.
    const user = userEvent.setup({ applyAccept: false });
    await openKnowledgeAsFile(user);

    await user.upload(
      await screen.findByLabelText('File'),
      new File(['%PDF-1.4'], 'manual.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText(/Choose a \.txt, \.md or \.csv file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
