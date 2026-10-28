/**
 * The AI configuration review line (tm 316.2 · SiyahTuş analysis AI-20 ·
 * ADR-14b `docs/adr/ai-config-versioning.md` §2.10, §2.11).
 *
 * The editing tables are the draft; the AI answers from a published,
 * immutable package. Between the two:
 *
 *   - **Submit** ("Onaya gönder"): the draft is compiled and judged
 *     (`config-compiler.ts`), the latest pre-publish run of this very draft
 *     revision must have passed the whole compliance pack (AI-19-S1), and the
 *     package is told against the published one. The new version is
 *     `in_review`; an open one it replaces is rejected (`superseded_by_submit`)
 *     — one open version per agent, so two approved packages never publish
 *     over each other in the wrong order.
 *   - **Approve**: never by the submitter (four eyes, enforced here, not in
 *     the screen), and by the Founder alone when the difference touches
 *     compliance. With `publish_at` it waits (`approved`, the scheduled job's —
 *     tm 316.6); without it, it is published at once.
 *   - **Publish** (one transaction): the licence's publication lock and the
 *     next `seq`; the old version `superseded`, this one `published`, the
 *     agent's pointer; the knowledge chunks' visibility ranges (§2.8); the
 *     AI-21 row and its audit entry. The compliance run is read again, and the
 *     base must still be the published version — when another went out in
 *     between, a version that only differs in knowledge the other did not touch
 *     follows it; one that collides is rejected (`stale_base`).
 *   - **Reject**, **rollback** (a new version copying an earlier one's
 *     package; closed chunk ranges are never reopened — their chunks are copied
 *     as a new generation; the draft is not touched) and **pause/resume** (the
 *     live switch, never versioned).
 *
 * Every step takes the agent's row `FOR UPDATE` first, so two steps on one
 * agent queue rather than interleave. After the commit the caller announces
 * a publication (`announceAiConfigPublished`, tm 316.3); the run time reads
 * the new pointer on its next turn (`config-source.ts`). Before a submission
 * the migration's baseline v1 is sealed (`config-baseline.ts`).
 */
import type { AiConfigVersion, Prisma } from '@prisma/client';
import {
  AI_COMPLIANCE_SCENARIO_KEY_PREFIX,
  AI_CONFIG_PACKAGE_FORMAT_BASELINE,
  aiConfigVersionLabel,
  guardrailSetupProblem,
  type AiConfigDiffSummary,
  type AiConfigKnowledgeManifestEntry,
  type AiConfigSystemReviewNote,
  type AiConfigVersionStateReason,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import { canonicalJson } from '../audit/audit-chain.js';
import {
  compileDraft,
  diffAiConfig,
  type AiConfigWarning,
  type CompiledAiConfig,
  type StoredAiConfig,
} from './config-compiler.js';
import { sealBaselines } from './config-baseline.js';
import { updateAiAgentDraft } from './config-draft.js';
import { recordChange, type ConfigChangeAuthor } from './config-history.js';
import { revisionConflict } from './draft-revision.js';
import {
  compliancePackGate,
  gateOf,
  type CompliancePackGate,
} from './simulation/compliance-pack.js';

/** `409 ai_config_version_state` with the reason the screen answers. */
export function versionState(
  reason: AiConfigVersionStateReason,
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return new ApiError('ai_config_version_state', message, { details: { reason, ...details } });
}

/** The agent's row as every step reads it — locked. */
export interface LockedAgent {
  id: string;
  licenseId: bigint;
  draftRevision: bigint;
  publishedVersionId: string | null;
  active: boolean;
}

/**
 * Lock a customer-facing agent's row for the rest of the transaction. A save
 * moving the draft revision waits on the same row (`draft-revision.ts`), so a
 * submission reads one revision and compiles exactly that draft.
 */
export async function lockAgent(tx: TenantClient, aiAgentId: string): Promise<LockedAgent> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      license_id: bigint;
      draft_revision: bigint;
      published_version_id: string | null;
      active: boolean;
    }>
  >`
    SELECT id::text AS id, license_id, draft_revision,
           published_version_id::text AS published_version_id, active
      FROM ai_agents
     WHERE id = ${aiAgentId}::uuid AND kind = 'ai_agent'
       FOR UPDATE`;
  const row = rows[0];
  if (!row) throw ApiError.notFound('AI agent not found.');
  return {
    id: row.id,
    licenseId: row.license_id,
    draftRevision: row.draft_revision,
    publishedVersionId: row.published_version_id,
    active: row.active,
  };
}

/** A version and its agent, the agent locked first and the version read after. */
async function lockVersion(
  tx: TenantClient,
  versionId: string,
): Promise<{ agent: LockedAgent; version: AiConfigVersion }> {
  const found = await tx.aiConfigVersion.findFirst({
    where: { id: versionId },
    select: { aiAgentId: true },
  });
  if (!found) throw ApiError.notFound('Version not found.');
  const agent = await lockAgent(tx, found.aiAgentId);
  const version = await tx.aiConfigVersion.findFirst({ where: { id: versionId } });
  if (!version) throw ApiError.notFound('Version not found.');
  return { agent, version };
}

export function storedOf(row: AiConfigVersion): StoredAiConfig {
  return {
    versionId: row.id,
    packageFormat: row.packageFormat,
    snapshot: row.snapshot,
    knowledgeManifest: row.knowledgeManifest,
  };
}

/**
 * What a draft is told against: the published version — or, while it is the
 * migration's unsealed v1, the tables as they are, which is what it stands for
 * until the draft first changes (`config-baseline.ts`): nothing to submit.
 */
function baseOf(published: AiConfigVersion, draft: CompiledAiConfig): StoredAiConfig {
  if (published.packageFormat !== AI_CONFIG_PACKAGE_FORMAT_BASELINE) return storedOf(published);
  const { packageFormat, snapshot, knowledgeManifest } = draft;
  return { versionId: published.id, packageFormat, snapshot, knowledgeManifest };
}

function manifestOf(
  version: Pick<StoredAiConfig, 'knowledgeManifest'> | null,
): AiConfigKnowledgeManifestEntry[] {
  const manifest = version?.knowledgeManifest;
  return Array.isArray(manifest) ? (manifest as AiConfigKnowledgeManifestEntry[]) : [];
}

/** A version's AI-21 record: what the review line changed, never the package itself. */
function versionRecord(row: AiConfigVersion): Record<string, unknown> {
  const diff = row.diffSummary as AiConfigDiffSummary | null;
  return {
    label: aiConfigVersionLabel(row),
    status: row.status,
    seq: row.seq === null ? null : Number(row.seq),
    draft_revision: Number(row.draftRevision),
    snapshot_hash: row.snapshotHash,
    base_version_id: row.baseVersionId,
    rollback_of: row.rollbackOf,
    test_run_id: row.testRunId,
    touches_compliance: row.touchesCompliance,
    changes: diff?.changes ?? null,
    scheduled_at: row.scheduledAt?.toISOString() ?? null,
  };
}

async function recordVersion(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  action: 'submitted' | 'approved' | 'rejected' | 'published' | 'rolled_back',
  row: AiConfigVersion,
  before: AiConfigVersion | null,
  note: string | null,
): Promise<void> {
  await recordChange(tx, author, {
    entityType: 'config_version',
    entityId: row.id,
    aiAgentId: row.aiAgentId,
    action,
    before: before ? versionRecord(before) : null,
    after: versionRecord(row),
    note,
    versionId: row.id,
    draftRevision: row.draftRevision,
  });
}

async function nextNumber(tx: TenantClient, aiAgentId: string): Promise<number> {
  const { _max } = await tx.aiConfigVersion.aggregate({
    where: { aiAgentId },
    _max: { number: true },
  });
  return (_max.number ?? 0) + 1;
}

/** The gate's details for a refusal: what the screen needs to say what to run. */
function gateDetails(gate: CompliancePackGate): Record<string, unknown> {
  return { gate_state: gate.state, run_id: gate.runId, failing: gate.failing };
}

/** Reject every open version of the agent, saying why (a system step). */
async function rejectOpen(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  aiAgentId: string,
  note: AiConfigSystemReviewNote,
  now: Date,
): Promise<string[]> {
  const open = await tx.aiConfigVersion.findMany({
    where: { aiAgentId, status: { in: ['in_review', 'approved'] } },
  });
  for (const version of open) {
    const rejected = await tx.aiConfigVersion.update({
      where: { id: version.id },
      data: { status: 'rejected', reviewNote: note, reviewedAt: now, reviewedBy: null },
    });
    await recordVersion(tx, author, 'rejected', rejected, version, note);
  }
  return open.map((version) => version.id);
}

// ---------------------------------------------------------------------------
// The draft as a submission would take it.
// ---------------------------------------------------------------------------

export interface DraftState {
  agent: { id: string; draftRevision: bigint; active: boolean };
  published: AiConfigVersion | null;
  open: AiConfigVersion | null;
  compilation: Awaited<ReturnType<typeof compileDraft>>;
  diff: AiConfigDiffSummary | null;
  gate: CompliancePackGate;
}

/** What "Onaya gönder" would do now: the draft compiled, told, and its gate. */
export async function readDraftState(tx: TenantClient, aiAgentId: string): Promise<DraftState> {
  const agent = await tx.aiAgent.findFirst({
    where: { id: aiAgentId, kind: 'ai_agent' },
    select: { id: true, draftRevision: true, active: true, publishedVersionId: true },
  });
  if (!agent) throw ApiError.notFound('AI agent not found.');
  const published = agent.publishedVersionId
    ? await tx.aiConfigVersion.findFirst({ where: { id: agent.publishedVersionId } })
    : null;
  const open = await tx.aiConfigVersion.findFirst({
    where: { aiAgentId, status: { in: ['in_review', 'approved'] } },
  });
  const compilation = await compileDraft(tx, aiAgentId);
  const revision = compilation.draftRevision ?? agent.draftRevision;
  const gate = await compliancePackGate(tx, { aiAgentId, draftRevision: Number(revision) });
  const diff = compilation.ok
    ? diffAiConfig(published ? baseOf(published, compilation.compiled) : null, compilation.compiled)
    : null;
  return {
    agent: { id: agent.id, draftRevision: revision, active: agent.active },
    published,
    open,
    compilation,
    diff,
    gate,
  };
}

// ---------------------------------------------------------------------------
// Submit.
// ---------------------------------------------------------------------------

export interface Submission {
  version: AiConfigVersion;
  warnings: AiConfigWarning[];
  /** The open version the submission replaced, if there was one. */
  replaced: string[];
}

/**
 * Submit the agent's draft for review. Refused, in this order: a draft
 * revision other than the author's `If-Match` (409
 * `ai_config_revision_conflict`); a draft that does not compile (400
 * `validation`, `details.problems`); a pack not passed for this revision, or
 * nothing to submit (409 `ai_config_version_state`).
 */
export async function submitVersion(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  input: { aiAgentId: string; submittedBy: string | null; note: string | null; now: Date },
): Promise<Submission> {
  const agent = await lockAgent(tx, input.aiAgentId);
  const expected = author.expectedRevision ?? null;
  if (expected !== null && expected !== agent.draftRevision) {
    throw revisionConflict(agent.id, agent.draftRevision, expected);
  }
  // The migration's v1 is the tables until now: told against, it is them (tm 316.3).
  await sealBaselines(tx);

  const compilation = await compileDraft(tx, agent.id);
  if (!compilation.ok) {
    throw ApiError.validation('The draft cannot be submitted until these are fixed.', {
      problems: compilation.problems,
      warnings: compilation.warnings,
    });
  }
  const revision = compilation.draftRevision;
  const gate = await compliancePackGate(tx, {
    aiAgentId: agent.id,
    draftRevision: Number(revision),
  });
  if (!gate.open) {
    throw versionState(
      'compliance_pack',
      'The compliance pack has not passed for this draft. Run the pre-publish test and fix what fails before submitting.',
      gateDetails(gate),
    );
  }

  const base = agent.publishedVersionId
    ? await tx.aiConfigVersion.findFirst({ where: { id: agent.publishedVersionId } })
    : null;
  const { compiled } = compilation;
  const diff = diffAiConfig(base ? storedOf(base) : null, compiled);
  if (diff.changes === 0) {
    throw versionState(
      'no_changes',
      'The draft is the published configuration: nothing to submit.',
    );
  }

  const replaced = await rejectOpen(tx, author, agent.id, 'superseded_by_submit', input.now);
  const version = await tx.aiConfigVersion.create({
    data: {
      licenseId: agent.licenseId,
      aiAgentId: agent.id,
      number: await nextNumber(tx, agent.id),
      minor: 0,
      status: 'in_review',
      snapshot: compiled.snapshot as unknown as Prisma.InputJsonObject,
      snapshotHash: compiled.snapshotHash,
      packageFormat: compiled.packageFormat,
      knowledgeManifest: compiled.knowledgeManifest as unknown as Prisma.InputJsonArray,
      diffSummary: diff as unknown as Prisma.InputJsonObject,
      baseVersionId: base?.id ?? null,
      draftRevision: revision,
      testRunId: gate.runId,
      touchesCompliance: diff.touches_compliance,
      submittedBy: input.submittedBy,
      submittedAt: input.now,
    },
  });
  await recordVersion(tx, author, 'submitted', version, null, input.note);
  return { version, warnings: compilation.warnings, replaced };
}

// ---------------------------------------------------------------------------
// Approve, reject.
// ---------------------------------------------------------------------------

/** Who reviews: the person, and their role now (the Founder rule reads it). */
export interface Reviewer {
  accountId: string;
  role: string;
}

export type PublishOutcome =
  | { kind: 'published'; version: AiConfigVersion; superseded: string | null }
  | { kind: 'scheduled'; version: AiConfigVersion }
  | { kind: 'rejected'; version: AiConfigVersion; reason: 'stale_base' };

/**
 * Approve an `in_review` version. The submitter never approves their own
 * (403 `not_allowed`, `own_submission`); a version touching compliance is the
 * Founder's (403 `not_allowed`, `owner_required`). With `publishAt` it waits
 * for the scheduled job; without, it is published in this transaction.
 */
export async function approveVersion(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  reviewer: Reviewer,
  input: { versionId: string; publishAt: Date | null; note: string | null; now: Date },
): Promise<PublishOutcome> {
  const { agent, version } = await lockVersion(tx, input.versionId);
  if (version.status !== 'in_review') {
    throw versionState('not_open', 'This version is not awaiting review.', {
      status: version.status,
    });
  }
  if (version.submittedBy !== null && version.submittedBy === reviewer.accountId) {
    throw new ApiError(
      'not_allowed',
      'You submitted this version; someone else has to approve it.',
      { details: { reason: 'own_submission' } },
    );
  }
  if (version.touchesCompliance && reviewer.role !== 'owner') {
    const diff = version.diffSummary as AiConfigDiffSummary | null;
    throw new ApiError(
      'not_allowed',
      'This version changes compliance rules; only the Founder can approve it.',
      { details: { reason: 'owner_required', compliance: diff?.compliance ?? [] } },
    );
  }

  const approved = await tx.aiConfigVersion.update({
    where: { id: version.id },
    data: {
      status: 'approved',
      reviewedBy: reviewer.accountId,
      reviewedAt: input.now,
      reviewNote: input.note,
      scheduledAt: input.publishAt,
    },
  });
  await recordVersion(tx, author, 'approved', approved, version, input.note);
  if (input.publishAt) return { kind: 'scheduled', version: approved };
  return publishLocked(tx, author, agent, approved, {
    publishedBy: reviewer.accountId,
    now: input.now,
  });
}

/** Reject an open version — `in_review`, or `approved` and waiting for its time. */
export async function rejectVersion(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  reviewer: Reviewer,
  input: { versionId: string; note: string | null; now: Date },
): Promise<AiConfigVersion> {
  const { version } = await lockVersion(tx, input.versionId);
  if (version.status !== 'in_review' && version.status !== 'approved') {
    throw versionState('not_open', 'This version is not awaiting review.', {
      status: version.status,
    });
  }
  const rejected = await tx.aiConfigVersion.update({
    where: { id: version.id },
    data: {
      status: 'rejected',
      reviewedBy: reviewer.accountId,
      reviewedAt: input.now,
      reviewNote: input.note,
    },
  });
  await recordVersion(tx, author, 'rejected', rejected, version, input.note);
  return rejected;
}

// ---------------------------------------------------------------------------
// Publish.
// ---------------------------------------------------------------------------

/**
 * Publish an approved version whose time has come — the scheduled job's way
 * in (tm 316.6). Everything an immediate approval checks is checked again.
 */
export async function publishVersion(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  input: { versionId: string; publishedBy: string | null; now: Date },
): Promise<PublishOutcome> {
  const { agent, version } = await lockVersion(tx, input.versionId);
  if (version.status !== 'approved') {
    throw versionState('not_open', 'This version is not approved.', { status: version.status });
  }
  return publishLocked(tx, author, agent, version, input);
}

/** The run a version was submitted on, as the gate reads it now. */
async function gateOfRun(tx: TenantClient, runId: string | null): Promise<CompliancePackGate> {
  if (runId === null) return gateOf(null, []);
  const run = await tx.aiTestRun.findFirst({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      failed: true,
      errored: true,
      compliancePackVersion: true,
      compliancePassed: true,
      complianceFailed: true,
    },
  });
  if (!run) return gateOf(null, []);
  const failing = await tx.aiTestRunResult.findMany({
    where: {
      runId,
      scenarioKey: { startsWith: AI_COMPLIANCE_SCENARIO_KEY_PREFIX },
      status: { not: 'passed' },
    },
    select: { scenarioKey: true },
  });
  return gateOf(
    run,
    failing.map((row) => row.scenarioKey),
  );
}

async function publishLocked(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  agent: LockedAgent,
  version: AiConfigVersion,
  input: { publishedBy: string | null; now: Date },
): Promise<PublishOutcome> {
  // The pack it passed may have moved on since (a deployment); the run may be gone.
  const gate = await gateOfRun(tx, version.testRunId);
  if (!gate.open) {
    throw versionState(
      'compliance_pack',
      'The compliance pack this version passed is no longer current. Run the pre-publish test again and resubmit.',
      gateDetails(gate),
    );
  }

  let manifest = manifestOf(storedOf(version));
  let baseVersionId = version.baseVersionId;
  let diffSummary = version.diffSummary as AiConfigDiffSummary | null;
  if ((version.baseVersionId ?? null) !== agent.publishedVersionId) {
    // Another version went out since this one was submitted (a rollback).
    const base = version.baseVersionId
      ? await tx.aiConfigVersion.findFirst({ where: { id: version.baseVersionId } })
      : null;
    const current = agent.publishedVersionId
      ? await tx.aiConfigVersion.findFirst({ where: { id: agent.publishedVersionId } })
      : null;
    const rebased = rebaseManifest(
      base ? storedOf(base) : null,
      current ? storedOf(current) : null,
      storedOf(version),
    );
    if (rebased === null) {
      const rejected = await tx.aiConfigVersion.update({
        where: { id: version.id },
        data: { status: 'rejected', reviewNote: 'stale_base', reviewedAt: input.now },
      });
      await recordVersion(tx, author, 'rejected', rejected, version, 'stale_base');
      return { kind: 'rejected', version: rejected, reason: 'stale_base' };
    }
    manifest = rebased;
    baseVersionId = current?.id ?? null;
    diffSummary = diffAiConfig(current ? storedOf(current) : null, {
      snapshot: version.snapshot,
      knowledgeManifest: manifest,
    });
  }

  const seq = await allocateSeq(tx, agent.licenseId);
  manifest = await openKnowledge(tx, agent.licenseId, manifest, seq);
  const superseded = await supersede(tx, agent);
  const published = await tx.aiConfigVersion.update({
    where: { id: version.id },
    data: {
      status: 'published',
      seq,
      publishedAt: input.now,
      publishedBy: input.publishedBy,
      knowledgeManifest: manifest as unknown as Prisma.InputJsonArray,
      baseVersionId,
      diffSummary: diffSummary as unknown as Prisma.InputJsonObject,
    },
  });
  await point(tx, agent.id, published.id);
  await recordVersion(tx, author, 'published', published, version, null);
  return { kind: 'published', version: published, superseded };
}

/**
 * The licence's next publication order, under its transaction lock — so
 * `seq` grows in commit order (§2.3). Past every chunk range already opened
 * too: a workspace whose chunks the migration opened at 1 without a v1 (it had
 * no agent then) starts above them.
 */
async function allocateSeq(tx: TenantClient, licenseId: bigint): Promise<bigint> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('siyahtus.ai-config-seq'), hashtext(${licenseId.toString()}))`;
  const rows = await tx.$queryRaw<Array<{ seq: bigint }>>`
    SELECT GREATEST(
             COALESCE((SELECT max(seq) FROM ai_config_versions WHERE license_id = ${licenseId}), 0),
             COALESCE((SELECT max(visible_from_version) FROM knowledge_chunks
                        WHERE license_id = ${licenseId}), 0)
           )::bigint + 1 AS seq`;
  return rows[0]!.seq;
}

/** The old version superseded — before the new one is published (one published per agent). */
async function supersede(tx: TenantClient, agent: LockedAgent): Promise<string | null> {
  if (agent.publishedVersionId === null) return null;
  await tx.aiConfigVersion.update({
    where: { id: agent.publishedVersionId },
    data: { status: 'superseded' },
  });
  return agent.publishedVersionId;
}

async function point(tx: TenantClient, aiAgentId: string, versionId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE ai_agents SET published_version_id = ${versionId}::uuid WHERE id = ${aiAgentId}::uuid`;
}

/**
 * The chunk ranges of a publication (§2.8 (3)). Each manifest generation's
 * chunks not yet open open at `seq`; a generation whose range was closed by an
 * earlier publication is never reopened — its chunks are copied as a new
 * generation (text and vector as they are, no embedding cost) that opens at
 * `seq`, and the manifest names the copy. Every other open chunk of the
 * workspace closes at `seq`. Returns the manifest as published.
 */
async function openKnowledge(
  tx: TenantClient,
  licenseId: bigint,
  manifest: AiConfigKnowledgeManifestEntry[],
  seq: bigint,
): Promise<AiConfigKnowledgeManifestEntry[]> {
  const closed = new Set<string>();
  if (manifest.length > 0) {
    const rows = await tx.$queryRaw<Array<{ source_id: string; generation: number }>>`
      SELECT DISTINCT c.source_id::text AS source_id, c.generation
        FROM knowledge_chunks c
        JOIN unnest(${manifest.map((entry) => entry.source_id)}::uuid[],
                    ${manifest.map((entry) => entry.generation)}::int[]) AS m(source_id, generation)
          ON m.source_id = c.source_id AND m.generation = c.generation
       WHERE c.license_id = ${licenseId} AND c.hidden_from_version IS NOT NULL`;
    for (const row of rows) closed.add(`${row.source_id}:${row.generation}`);
  }

  const out: AiConfigKnowledgeManifestEntry[] = [];
  for (const entry of manifest) {
    if (!closed.has(`${entry.source_id}:${entry.generation}`)) {
      out.push(entry);
      continue;
    }
    const copied = await tx.$queryRaw<Array<{ generation: number }>>`
      WITH next AS (
        SELECT GREATEST(s.chunk_generation,
                        COALESCE((SELECT max(c.generation) FROM knowledge_chunks c
                                   WHERE c.source_id = s.id), 0)) + 1 AS generation
          FROM knowledge_sources s
         WHERE s.id = ${entry.source_id}::uuid
      )
      INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding,
                                    embedding_space, token_count, position, page_id,
                                    page_from, page_to, heading, generation,
                                    visible_from_version)
      SELECT gen_random_uuid(), c.source_id, c.license_id, c.chunk_text, c.embedding,
             c.embedding_space, c.token_count, c.position, c.page_id,
             c.page_from, c.page_to, c.heading, next.generation, ${seq}
        FROM knowledge_chunks c, next
       WHERE c.source_id = ${entry.source_id}::uuid AND c.generation = ${entry.generation}
      RETURNING generation`;
    const generation = copied[0]?.generation ?? entry.generation;
    out.push({ ...entry, generation });
  }

  if (out.length > 0) {
    await tx.$executeRaw`
      UPDATE knowledge_chunks c SET visible_from_version = ${seq}
        FROM unnest(${out.map((entry) => entry.source_id)}::uuid[],
                    ${out.map((entry) => entry.generation)}::int[]) AS m(source_id, generation)
       WHERE c.license_id = ${licenseId}
         AND c.source_id = m.source_id AND c.generation = m.generation
         AND c.visible_from_version IS NULL`;
  }
  await tx.$executeRaw`
    UPDATE knowledge_chunks c SET hidden_from_version = ${seq}
     WHERE c.license_id = ${licenseId}
       AND c.visible_from_version IS NOT NULL
       AND c.hidden_from_version IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(${out.map((entry) => entry.source_id)}::uuid[],
                       ${out.map((entry) => entry.generation)}::int[]) AS m(source_id, generation)
          WHERE m.source_id = c.source_id AND m.generation = c.generation)`;
  return out;
}

/**
 * The manifest a version publishes with when another version went out after
 * its base (§2.10 (4)), or null — it is stale. Only knowledge may have moved
 * in between: every other section of the published package must be the base's.
 * The sources the other publication changed must be ones this version did not
 * change; those then follow the published package, the rest stay this
 * version's.
 */
export function rebaseManifest(
  base: StoredAiConfig | null,
  current: StoredAiConfig | null,
  next: Pick<StoredAiConfig, 'snapshot' | 'knowledgeManifest'>,
): AiConfigKnowledgeManifestEntry[] | null {
  if (current === null) return null;
  const drift = diffAiConfig(base, current);
  if (drift.sections.some((section) => section.section !== 'knowledge')) return null;
  const was = keyed(manifestOf(base));
  const theirs = keyed(manifestOf(current));
  const mine = keyed(manifestOf(next));
  const moved = changedKeys(was, theirs);
  for (const key of changedKeys(was, mine)) if (moved.has(key)) return null;
  const out = new Map(manifestOf(next).map((entry) => [entry.source_id, entry]));
  for (const key of moved) {
    const entry = manifestOf(current).find((item) => item.source_id === key);
    if (entry) out.set(key, entry);
    else out.delete(key);
  }
  return [...out.values()].sort((a, b) =>
    a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0,
  );
}

function keyed(manifest: AiConfigKnowledgeManifestEntry[]): Map<string, string> {
  return new Map(manifest.map((entry) => [entry.source_id, canonicalJson(entry)]));
}

function changedKeys(a: Map<string, string>, b: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) !== b.get(key)) out.add(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rollback.
// ---------------------------------------------------------------------------

/**
 * A new version copying an earlier published one's package (§2.10 (7)),
 * published at once — a single administrator's step (AI-20-S3). History is not
 * rewritten and the draft is not touched: what the rollback undid stays in the
 * draft as a pending change. Refused for the version in production, one never
 * published, the migration's uncompiled v1, and one whose chunks the clean-up
 * has taken.
 */
export async function rollbackToVersion(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  input: { versionId: string; actor: string; note: string | null; now: Date },
): Promise<AiConfigVersion> {
  const { agent, version: target } = await lockVersion(tx, input.versionId);
  if (target.id === agent.publishedVersionId) {
    throw versionState('rollback_current', 'This version is the one in production.');
  }
  if (target.seq === null) {
    throw versionState(
      'rollback_unpublished',
      'Only a version that was published can be rolled back to.',
      {
        status: target.status,
      },
    );
  }
  if (target.packageFormat === AI_CONFIG_PACKAGE_FORMAT_BASELINE) {
    throw versionState(
      'rollback_baseline',
      'The first version was recorded before versioning and holds no package to copy.',
    );
  }

  const manifest = manifestOf(storedOf(target));
  if (manifest.length > 0) {
    const counted = await tx.$queryRaw<
      Array<{ source_id: string; generation: number; chunks: bigint }>
    >`
      SELECT c.source_id::text AS source_id, c.generation, count(*)::bigint AS chunks
        FROM knowledge_chunks c
        JOIN unnest(${manifest.map((entry) => entry.source_id)}::uuid[],
                    ${manifest.map((entry) => entry.generation)}::int[]) AS m(source_id, generation)
          ON m.source_id = c.source_id AND m.generation = c.generation
       WHERE c.license_id = ${agent.licenseId}
       GROUP BY c.source_id, c.generation`;
    const have = new Map(
      counted.map((row) => [`${row.source_id}:${row.generation}`, Number(row.chunks)]),
    );
    const purged = manifest.filter(
      (entry) =>
        (have.get(`${entry.source_id}:${entry.generation}`) ?? 0) < (entry.chunk_count ?? 0),
    );
    if (purged.length > 0) {
      throw versionState(
        'knowledge_purged',
        'Some knowledge this version answered from has been cleaned up, so it cannot be restored.',
        { source_ids: purged.map((entry) => entry.source_id) },
      );
    }
  }

  const current = agent.publishedVersionId
    ? await tx.aiConfigVersion.findFirst({ where: { id: agent.publishedVersionId } })
    : null;
  const number = await nextNumber(tx, agent.id);
  const seq = await allocateSeq(tx, agent.licenseId);
  const published = await openKnowledge(tx, agent.licenseId, manifest, seq);
  const diff = diffAiConfig(current ? storedOf(current) : null, {
    snapshot: target.snapshot,
    knowledgeManifest: published,
  });
  await supersede(tx, agent);
  const version = await tx.aiConfigVersion.create({
    data: {
      licenseId: agent.licenseId,
      aiAgentId: agent.id,
      number,
      minor: 0,
      seq,
      status: 'published',
      snapshot: target.snapshot as Prisma.InputJsonObject,
      snapshotHash: target.snapshotHash,
      packageFormat: target.packageFormat,
      knowledgeManifest: published as unknown as Prisma.InputJsonArray,
      diffSummary: diff as unknown as Prisma.InputJsonObject,
      baseVersionId: current?.id ?? null,
      draftRevision: target.draftRevision,
      testRunId: target.testRunId,
      touchesCompliance: diff.touches_compliance,
      submittedBy: input.actor,
      submittedAt: input.now,
      reviewNote: input.note,
      publishedBy: input.actor,
      publishedAt: input.now,
      rollbackOf: target.id,
    },
  });
  await point(tx, agent.id, version.id);
  await recordVersion(tx, author, 'rolled_back', version, null, input.note);
  return version;
}

// ---------------------------------------------------------------------------
// Pause, resume.
// ---------------------------------------------------------------------------

/**
 * Stop or restart the agent's answers (§2.10 (6)): `ai_agents.active`, read
 * live on every turn and never versioned, recorded as `paused`/`resumed`.
 * Asking for the state it is already in changes and records nothing. Switching
 * it back on passes the guardrail gate a `PATCH /ai-agents` passes (AI-08-S1).
 */
export async function setAgentPaused(
  tx: TenantClient,
  author: ConfigChangeAuthor,
  input: { aiAgentId: string; paused: boolean; note: string | null },
): Promise<{ id: string; active: boolean; changed: boolean }> {
  const agent = await lockAgent(tx, input.aiAgentId);
  const active = !input.paused;
  if (agent.active === active) return { id: agent.id, active, changed: false };
  if (active) {
    const settings = await tx.aiGuardrailSettings.findUnique({
      where: { aiAgentId: agent.id },
      select: { crisisText: true, approvedAt: true },
    });
    const problem = guardrailSetupProblem(settings);
    if (problem) {
      throw new ApiError(
        'ai_guardrail_setup_incomplete',
        problem === 'crisis_text_missing'
          ? 'Write the crisis text in the guardrail settings and approve it before switching the AI agent on.'
          : 'The crisis text has not been approved by the owner; approve it before switching the AI agent on.',
        { details: { reason: problem } },
      );
    }
  }
  await updateAiAgentDraft(tx, author, agent.id, { active }, {}, input.note);
  return { id: agent.id, active, changed: true };
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------

export function serialiseVersion(row: AiConfigVersion) {
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    number: row.number,
    minor: row.minor,
    label: aiConfigVersionLabel(row),
    seq: row.seq === null ? null : Number(row.seq),
    status: row.status,
    package_format: row.packageFormat,
    snapshot_hash: row.snapshotHash,
    draft_revision: Number(row.draftRevision),
    base_version_id: row.baseVersionId,
    rollback_of: row.rollbackOf,
    test_run_id: row.testRunId,
    touches_compliance: row.touchesCompliance,
    diff_summary: (row.diffSummary as AiConfigDiffSummary | null) ?? null,
    knowledge_sources: manifestOf(storedOf(row)).length,
    submitted_by: row.submittedBy,
    submitted_at: row.submittedAt?.toISOString() ?? null,
    reviewed_by: row.reviewedBy,
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    review_note: row.reviewNote,
    published_by: row.publishedBy,
    published_at: row.publishedAt?.toISOString() ?? null,
    scheduled_at: row.scheduledAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
