/**
 * The Playbook's version bar (tm 316.4 · AI-20): "Live: v2 · Draft: 3
 * changes", the difference behind "See changes", "Send for review" closed
 * with its reason while the compliance pack has not passed, the submission
 * carrying the draft revision in `If-Match`, and a revision conflict read as
 * "someone else changed the draft". The "Draft" strip names the live version.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import type { AiConfigDraft, AiConfigVersion } from './ai-config.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { DraftStrip, VersionBar } = await import('./VersionBar.js');

const AGENT = 'b1111111-1111-4111-8111-111111111111';
const SKILL = 'a1111111-1111-4111-8111-111111111111';

const V2: AiConfigVersion = {
  id: 'v2222222-2222-4222-8222-222222222222',
  ai_agent_id: AGENT,
  number: 2,
  minor: 0,
  label: 'v2',
  seq: 2,
  status: 'published',
  package_format: 1,
  snapshot_hash: 'a'.repeat(64),
  draft_revision: 3,
  base_version_id: null,
  rollback_of: null,
  test_run_id: null,
  touches_compliance: false,
  diff_summary: null,
  knowledge_sources: 0,
  submitted_by: 'a-lead',
  submitted_at: '2026-10-27T09:00:00.000Z',
  reviewed_by: 'a-1',
  reviewed_at: '2026-10-27T10:00:00.000Z',
  review_note: null,
  published_by: 'a-1',
  published_at: '2026-10-27T10:00:00.000Z',
  scheduled_at: null,
  created_at: '2026-10-27T09:00:00.000Z',
};

function draft(extra: Partial<AiConfigDraft> = {}): AiConfigDraft {
  return {
    ai_agent_id: AGENT,
    draft_revision: 7,
    active: true,
    published: V2,
    open: null,
    ok: true,
    problems: [],
    warnings: [],
    diff: {
      base_version_id: V2.id,
      from_baseline: false,
      changes: 3,
      sections: [
        {
          section: 'skills',
          added: 1,
          removed: 0,
          changed: 1,
          items: [
            { key: SKILL, kind: 'changed' },
            { key: 'a2222222-2222-4222-8222-222222222222', kind: 'added' },
          ],
        },
        {
          section: 'agent',
          added: 0,
          removed: 0,
          changed: 1,
          items: [{ key: 'style', kind: 'changed' }],
        },
      ],
      touches_compliance: false,
      compliance: [],
    },
    compliance_gate: { state: 'passed', open: true, run_id: 'r1' },
    submittable: true,
    ...extra,
  };
}

function renderBar(onOpenTests = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <VersionBar
        agentId={AGENT}
        canSubmit
        names={new Map([[SKILL, 'Withdrawal delayed']])}
        onOpenTests={onOpenTests}
        onOpenVersions={vi.fn()}
      />
      <DraftStrip agentId={AGENT} />
    </QueryClientProvider>,
  );
  return { onOpenTests, queryClient };
}

describe('VersionBar (AI-20 · tm 316.4)', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('says what is live and how many changes the draft holds, and shows them by name', async () => {
    api.get.mockResolvedValue(draft());
    const user = userEvent.setup();
    renderBar();

    expect(await screen.findByTestId('ai-version-live')).toHaveTextContent('Live: v2');
    expect(screen.getByTestId('ai-version-draft')).toHaveTextContent('Draft: 3 changes');
    expect(api.get).toHaveBeenCalledWith(`/ai/config/draft/diff?ai_agent_id=${AGENT}`);
    expect(screen.getByTestId('ai-draft-strip')).toHaveTextContent(
      'The AI keeps answering from v2 until a new version is approved.',
    );

    await user.click(screen.getByRole('button', { name: 'See changes' }));
    const skills = screen.getByTestId('ai-config-diff-skills');
    expect(skills).toHaveTextContent('Withdrawal delayed');
    expect(skills).toHaveTextContent('+1 · −0 · ~1');
    expect(screen.getByTestId('ai-config-diff-agent')).toHaveTextContent('Style');
  });

  it('keeps "Send for review" closed while the compliance pack has not passed, and says why (AI-20 KK)', async () => {
    api.get.mockResolvedValue(
      draft({
        submittable: false,
        compliance_gate: { state: 'failed', open: false, run_id: 'r1' },
      }),
    );
    const user = userEvent.setup();
    const { onOpenTests } = renderBar();

    const submit = await screen.findByRole('button', { name: 'Send for review' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(
      /Publishing closed — the pack did not pass\. The compliance pack must pass for this draft\./,
    );
    await user.click(screen.getByRole('button', { name: 'Run the pre-publish test' }));
    expect(onOpenTests).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('lists the problems of a draft that does not compile', async () => {
    api.get.mockResolvedValue(
      draft({
        ok: false,
        submittable: false,
        diff: null,
        problems: [
          {
            code: 'handoff_target_unknown_team',
            section: 'handoff',
            key: 'rule:x',
            message: 'Rule "VIP" hands over to a team that is gone',
          },
        ],
      }),
    );
    renderBar();
    expect(await screen.findByTestId('ai-version-draft')).toHaveTextContent(
      'Draft: does not compile',
    );
    expect(screen.getByRole('list', { name: 'Problems in the draft' })).toHaveTextContent(
      'Rule "VIP" hands over to a team that is gone',
    );
    expect(screen.getByRole('button', { name: 'See changes' })).toBeDisabled();
  });

  it('submits the revision it was drawn from and says the version is waiting', async () => {
    api.get.mockResolvedValue(draft());
    api.post.mockResolvedValue({
      version: { ...V2, id: 'v3', number: 3, label: 'v3', status: 'in_review' },
      warnings: [],
      replaced_version_ids: [],
    });
    const user = userEvent.setup();
    renderBar();

    await user.type(await screen.findByLabelText('Note for the reviewer (optional)'), 'new tone');
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(api.post).toHaveBeenCalledWith(
      '/ai/config/versions',
      { ai_agent_id: AGENT, note: 'new tone' },
      { headers: { 'If-Match': '"7"' } },
    );
    expect(await screen.findByRole('status')).toHaveTextContent('v3 was sent for review.');
  });

  it('reads a revision conflict as somebody else’s save, and reloads the draft', async () => {
    api.get.mockResolvedValue(draft());
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'ai_config_revision_conflict',
        status: 409,
        message: 'moved',
        requestId: 'r',
        details: { current_revision: 8 },
      }),
    );
    const user = userEvent.setup();
    renderBar();

    await user.click(await screen.findByRole('button', { name: 'Send for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else changed the draft meanwhile.',
    );
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(1));
  });

  it('warns that a new submission replaces the one waiting', async () => {
    api.get.mockResolvedValue(
      draft({ open: { ...V2, id: 'v3', label: 'v3', status: 'in_review' } }),
    );
    renderBar();
    expect(await screen.findByTestId('ai-version-open')).toHaveTextContent(
      'v3 is waiting for review.',
    );
    expect(
      screen.getByText('Sending this draft replaces v3, which is waiting now.'),
    ).toBeInTheDocument();
  });

  it('reads the draft again after any save on the page, whichever key the editor invalidates', async () => {
    api.get
      .mockResolvedValueOnce(draft())
      .mockResolvedValue(draft({ diff: { ...draft().diff!, changes: 4 } }));
    const { queryClient } = renderBar();
    expect(await screen.findByTestId('ai-version-draft')).toHaveTextContent('Draft: 3 changes');

    // An editor's own save (the profile form, a table row…): a mutation the bar knows nothing of.
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: async () => 'saved' })
      .execute(undefined);
    expect(await screen.findByText('Draft: 4 changes', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('draws nothing for an answer that is not a draft', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderBar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('ai-version-bar')).toBeNull();
    expect(screen.queryByTestId('ai-draft-strip')).toBeNull();
  });
});
