/**
 * The AI configuration's versions as the Playbook reads them (tm 316.4 ·
 * SiyahTuş analysis AI-20 · ADR-14b §2.10): the draft as a submission would
 * take it (`GET /ai/config/draft/diff`), the version list, one version told
 * against another, and the review line's writes.
 *
 * The editing tables are the draft; the AI answers from the published version.
 * The version bar says how far apart the two are ("Yayında v12 · Taslak 7
 * değişiklik"), the Versions tab is where a reviewer approves, rejects and
 * rolls back.
 */
import type {
  AiComplianceGateState,
  AiConfigDiffSummary,
  AiConfigSection,
  AiConfigVersionStatus,
} from '@siyahtus/types';

export type { AiConfigDiffSummary };

export interface AiConfigFinding {
  code: string;
  section: AiConfigSection | null;
  key: string | null;
  message: string;
  details?: Record<string, unknown>;
}

export interface AiConfigVersion {
  id: string;
  ai_agent_id: string;
  number: number;
  minor: number;
  label: string;
  seq: number | null;
  status: AiConfigVersionStatus;
  package_format: number;
  snapshot_hash: string;
  draft_revision: number;
  base_version_id: string | null;
  rollback_of: string | null;
  test_run_id: string | null;
  touches_compliance: boolean;
  diff_summary: AiConfigDiffSummary | null;
  knowledge_sources: number;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  published_by: string | null;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
}

export interface AiConfigVersionList {
  versions: AiConfigVersion[];
  next_cursor: string | null;
}

export interface AiConfigDraft {
  ai_agent_id: string;
  draft_revision: number;
  /** False — the agent is paused. */
  active: boolean;
  published: AiConfigVersion | null;
  open: AiConfigVersion | null;
  ok: boolean;
  problems: AiConfigFinding[];
  warnings: AiConfigFinding[];
  diff: AiConfigDiffSummary | null;
  compliance_gate: { state: AiComplianceGateState; open: boolean; run_id: string | null };
  submittable: boolean;
}

/**
 * Whether an answer is a draft at all. Anything else — an older server without
 * the endpoint, a proxy's page — draws no bar rather than a broken one.
 */
export function isAiConfigDraft(value: unknown): value is AiConfigDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<AiConfigDraft>;
  return (
    Array.isArray(draft.problems) &&
    typeof draft.compliance_gate === 'object' &&
    draft.compliance_gate !== null &&
    typeof draft.draft_revision === 'number'
  );
}

export interface AiConfigSubmission {
  version: AiConfigVersion;
  warnings: AiConfigFinding[];
  replaced_version_ids: string[];
}

export const aiConfigKeys = {
  all: ['playbook', 'ai-config'] as const,
  draft: (agentId: string) => ['playbook', 'ai-config', 'draft', agentId] as const,
  versions: (agentId: string) => ['playbook', 'ai-config', 'versions', agentId] as const,
  diff: (from: string, to: string) => ['playbook', 'ai-config', 'diff', from, to] as const,
};

export function draftPath(agentId: string): string {
  return `/ai/config/draft/diff?ai_agent_id=${encodeURIComponent(agentId)}`;
}

export function versionsPath(agentId: string, cursor: string | null): string {
  const params = new URLSearchParams({ ai_agent_id: agentId });
  if (cursor) params.set('cursor', cursor);
  return `/ai/config/versions?${params.toString()}`;
}

export function versionDiffPath(from: string, to: string): string {
  return `/ai/config/versions/${encodeURIComponent(from)}/diff/${encodeURIComponent(to)}`;
}

/**
 * The `If-Match` a submission sends: the revision the bar was drawn from. A
 * save someone made since moved it, and the server answers 409
 * `ai_config_revision_conflict` instead of submitting a draft nobody here saw.
 */
export function ifMatch(revision: number): RequestInit {
  return { headers: { 'If-Match': `"${revision}"` } };
}

/**
 * Why "Onaya gönder" is closed, in the order a person fixes them: the draft
 * does not compile, nothing to send, the compliance pack has not passed for
 * this revision. Null — it is open. A version already waiting does not close
 * it: a new submission takes that one's place (`superseded_by_submit`).
 */
export type SubmitBlock =
  | { kind: 'no_changes' }
  | { kind: 'problems'; count: number }
  | { kind: 'compliance'; state: AiComplianceGateState };

export function submitBlock(draft: AiConfigDraft): SubmitBlock | null {
  if (draft.submittable) return null;
  if (!draft.ok) return { kind: 'problems', count: draft.problems.length };
  if (draft.diff && draft.diff.changes === 0) return { kind: 'no_changes' };
  if (!draft.compliance_gate.open)
    return { kind: 'compliance', state: draft.compliance_gate.state };
  return { kind: 'no_changes' };
}

/**
 * Why the caller may not approve this version, before asking the server: one's
 * own submission (four eyes), and a compliance change for anyone but the
 * Founder. The server refuses both anyway (403 `not_allowed`); the reason here
 * is so the button says why rather than failing.
 */
export type ApproveBlock = 'own_submission' | 'owner_required';

export function approveBlock(
  version: Pick<AiConfigVersion, 'submitted_by' | 'touches_compliance'>,
  me: { accountId: string; role: string },
): ApproveBlock | null {
  if (version.submitted_by !== null && version.submitted_by === me.accountId) {
    return 'own_submission';
  }
  if (version.touches_compliance && me.role !== 'owner') return 'owner_required';
  return null;
}

/** The statuses a reviewer can still act on. */
export function isOpenVersion(version: Pick<AiConfigVersion, 'status'>): boolean {
  return version.status === 'in_review' || version.status === 'approved';
}

/** A rollback copies a published version's package; the live one and the baseline v1 have none to give. */
export function canRollBackTo(
  version: Pick<AiConfigVersion, 'status' | 'package_format' | 'published_at'>,
): boolean {
  return version.status === 'superseded' && version.package_format > 0;
}

/**
 * `<input type="datetime-local">`'s value as the ISO instant `publish_at`
 * sends, read in the browser's zone. Empty — publish now.
 */
export function publishAtFromInput(value: string): string | null {
  if (value.trim() === '') return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
