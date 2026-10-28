/**
 * Playbook › Versions (tm 316.4 · AI-20): the list names each version's
 * state; "Approve" is closed for one's own submission and, for anyone but the
 * Founder, for a compliance change; an approval with a time schedules it; a
 * rollback asks once more and posts; two versions are compared.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { useAuth } from '../../lib/auth-store.js';
import type { AiConfigVersion } from './ai-config.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { Versions } = await import('./Versions.js');

const AGENT = 'b1111111-1111-4111-8111-111111111111';

function version(extra: Partial<AiConfigVersion>): AiConfigVersion {
  return {
    id: 'v1',
    ai_agent_id: AGENT,
    number: 1,
    minor: 0,
    label: 'v1',
    seq: 1,
    status: 'superseded',
    package_format: 1,
    snapshot_hash: 'a'.repeat(64),
    draft_revision: 1,
    base_version_id: null,
    rollback_of: null,
    test_run_id: null,
    touches_compliance: false,
    diff_summary: null,
    knowledge_sources: 0,
    submitted_by: 'a-lead',
    submitted_at: '2026-10-26T09:00:00.000Z',
    reviewed_by: 'a-owner',
    reviewed_at: '2026-10-26T10:00:00.000Z',
    review_note: null,
    published_by: 'a-owner',
    published_at: '2026-10-26T10:00:00.000Z',
    scheduled_at: null,
    created_at: '2026-10-26T09:00:00.000Z',
    ...extra,
  };
}

const V1 = version({});
const V2 = version({ id: 'v2', number: 2, label: 'v2', seq: 2, status: 'published' });
const V3 = version({
  id: 'v3',
  number: 3,
  label: 'v3',
  seq: null,
  status: 'in_review',
  published_by: null,
  published_at: null,
  reviewed_by: null,
  reviewed_at: null,
  diff_summary: {
    base_version_id: 'v2',
    from_baseline: false,
    changes: 1,
    sections: [
      {
        section: 'agent',
        added: 0,
        removed: 0,
        changed: 1,
        items: [{ key: 'persona', kind: 'changed' }],
      },
    ],
    touches_compliance: false,
    compliance: [],
  },
});

function signIn(accountId: string, role: string): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: accountId,
      email: null,
      name: null,
      role,
      organization_id: 'o-1',
      license_id: '1',
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function mockList(versions: AiConfigVersion[]): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/ai/config/versions?')) return { versions, next_cursor: null };
    if (path === '/agents') {
      return {
        items: [
          { id: 'a-lead', name: 'Lale' },
          { id: 'a-owner', name: 'Okan' },
        ],
      };
    }
    if (path.includes('/diff/')) {
      return {
        base_version_id: 'v1',
        from_baseline: false,
        changes: 2,
        sections: [{ section: 'skills', added: 2, removed: 0, changed: 0, items: [] }],
        touches_compliance: false,
        compliance: [],
      };
    }
    throw new Error(`unexpected ${path}`);
  });
}

function renderVersions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Versions agentId={AGENT} canReview />
    </QueryClientProvider>,
  );
}

async function rowOf(label: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('ai-version-row');
  const row = rows.find((candidate) => within(candidate).queryByText(label, { exact: true }));
  if (!row) throw new Error(`no row ${label}`);
  return row;
}

describe('Versions (AI-20 · tm 316.4)', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    signIn('a-admin', 'admin');
  });

  it('names each version’s state and who sent and published it', async () => {
    mockList([V3, V2, V1]);
    renderVersions();
    const live = await rowOf('v2');
    expect(live).toHaveTextContent('Live');
    expect(await within(live).findByText(/Sent by Lale · published by Okan/)).toBeInTheDocument();
    expect(await rowOf('v3')).toHaveTextContent('Waiting for review');
    expect(await rowOf('v1')).toHaveTextContent('Replaced');
  });

  it('closes approval of one’s own submission (four eyes · AI-20 KK)', async () => {
    signIn('a-lead', 'admin');
    mockList([V3, V2]);
    renderVersions();
    const row = await rowOf('v3');
    expect(within(row).getByRole('button', { name: 'Approve and publish' })).toBeDisabled();
    expect(row).toHaveTextContent('You sent this version, so someone else has to approve it.');
    // The submitter may still take it back.
    expect(within(row).getByRole('button', { name: 'Withdraw' })).toBeEnabled();
  });

  it('leaves a compliance change to the Founder (AI-20 KK)', async () => {
    mockList([{ ...V3, touches_compliance: true }, V2]);
    renderVersions();
    const row = await rowOf('v3');
    expect(within(row).getByRole('button', { name: 'Approve and publish' })).toBeDisabled();
    expect(row).toHaveTextContent('only the Founder can approve it');
  });

  it('approves somebody else’s version, at a time when one is given', async () => {
    mockList([V3, V2]);
    api.post.mockResolvedValue({ ...V3, status: 'approved' });
    const user = userEvent.setup();
    renderVersions();
    const row = await rowOf('v3');

    await user.type(within(row).getByLabelText('Publish at (empty: now)'), '2026-11-02T09:30');
    await user.click(within(row).getByRole('button', { name: 'Approve and schedule' }));
    expect(api.post).toHaveBeenCalledWith('/ai/config/versions/v3/approve', {
      publish_at: new Date('2026-11-02T09:30').toISOString(),
    });
  });

  it('rejects with the note', async () => {
    mockList([V3, V2]);
    api.post.mockResolvedValue({ ...V3, status: 'rejected' });
    const user = userEvent.setup();
    renderVersions();
    const row = await rowOf('v3');
    await user.type(within(row).getByLabelText('Note (optional)'), 'tone too loud');
    await user.click(within(row).getByRole('button', { name: 'Reject' }));
    expect(api.post).toHaveBeenCalledWith('/ai/config/versions/v3/reject', {
      note: 'tone too loud',
    });
  });

  it('rolls back to a replaced version only after a second click', async () => {
    mockList([V2, V1]);
    api.post.mockResolvedValue({
      ...V1,
      id: 'v3',
      label: 'v3',
      status: 'published',
      rollback_of: 'v1',
    });
    const user = userEvent.setup();
    renderVersions();
    // The live version offers no rollback to itself.
    expect(
      within(await rowOf('v2')).queryByRole('button', { name: 'Roll back to this version' }),
    ).toBeNull();

    const row = await rowOf('v1');
    await user.click(within(row).getByRole('button', { name: 'Roll back to this version' }));
    expect(api.post).not.toHaveBeenCalled();
    await user.click(within(row).getByRole('button', { name: 'Roll back to v1' }));
    expect(api.post).toHaveBeenCalledWith('/ai/config/versions/v1/rollback', {});
    expect(await within(row).findByRole('status')).toHaveTextContent('v3 is live.');
  });

  it('compares two versions', async () => {
    mockList([V2, V1]);
    const user = userEvent.setup();
    renderVersions();
    await user.click(await screen.findByRole('button', { name: 'Compare' }));
    expect(api.get).toHaveBeenCalledWith('/ai/config/versions/v1/diff/v2');
    expect(await screen.findByTestId('ai-versions-compare')).toHaveTextContent('2 changes');
  });

  it('opens a version’s own changes', async () => {
    mockList([V3, V2]);
    const user = userEvent.setup();
    renderVersions();
    const row = await rowOf('v3');
    await user.click(within(row).getByRole('button', { name: 'See 1 change' }));
    expect(within(row).getByTestId('ai-config-diff-agent')).toHaveTextContent('Persona');
  });
  describe('a linked version (?version=)', () => {
    afterEach(() => window.history.replaceState(null, '', '/'));

    it('marks it on the loaded page with its changes open', async () => {
      window.history.replaceState(null, '', '/?view=versions&version=v3');
      mockList([V3, V2]);
      renderVersions();
      const row = await rowOf('v3');
      expect(row).toHaveAttribute('aria-current', 'true');
      expect(within(row).getByTestId('ai-config-diff-agent')).toBeInTheDocument();
    });

    it('reads one further down the list on its own', async () => {
      window.history.replaceState(null, '', '/?view=versions&version=v1');
      mockList([V2]);
      const page = api.get.getMockImplementation()!;
      api.get.mockImplementation(async (path: string) =>
        path === '/ai/config/versions/v1' ? V1 : page(path),
      );
      renderVersions();
      await screen.findByText('v1', { exact: true });
      const row = await rowOf('v1');
      expect(row).toHaveAttribute('aria-current', 'true');
      expect(api.get).toHaveBeenCalledWith('/ai/config/versions/v1');
    });
  });
});
