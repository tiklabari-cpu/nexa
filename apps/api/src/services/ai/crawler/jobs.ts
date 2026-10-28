/**
 * The knowledge job queue (tm 312.3 · AI-17): `knowledge_jobs` rows, how they
 * are queued, claimed, moved on and ended — the `ai_test_runs` pattern
 * (`simulation/test-runs.ts`) on a table of its own.
 *
 * A route or the freshness sweep queues a job inside its tenant
 * ({@link enqueueKnowledgeJob}); a runner takes it through
 * `knowledge_jobs_claim` (`20261111090000_knowledge_jobs_claim`) — the one
 * cross-tenant read, one job running per workspace — and writes everything
 * after that inside the job's tenant, **fenced by the claim**: a write names
 * the job, `status = 'running'` and the attempt number the claim returned,
 * so a runner whose lease ran out (another took the job over) or whose job
 * was cancelled under it changes nothing and learns it has lost the job.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  KNOWLEDGE_JOB_ACTIVE_STATUSES,
  type KnowledgeJobKind,
  type KnowledgeJobStatus,
} from '@siyahtus/types';
import { ApiError } from '../../../lib/api-error.js';
import { type TenantClient, type TenantContext, withTenant } from '../../../lib/tenant.js';
import type { FrontierEntry } from './frontier.js';

/** How long a claim holds its job; the runner moves it on every third of it. */
export const KNOWLEDGE_JOB_LEASE_MS = 60_000;
/** Claims a job may have; past the last one that died, it fails (`attempts_exhausted`). */
export const KNOWLEDGE_JOB_MAX_ATTEMPTS = 3;

export interface KnowledgeJobClaim {
  id: string;
  sourceId: string;
  kind: KnowledgeJobKind;
  context: TenantContext;
  attempts: number;
}

interface ClaimRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  source_id: string;
  kind: string;
  attempts: number;
}

/** The oldest due job, now `running` under a lease — or null. One per workspace at a time. */
export async function claimKnowledgeJob(
  db: PrismaClient,
  options: { leaseMs: number; maxAttempts: number },
): Promise<KnowledgeJobClaim | null> {
  const rows = await db.$queryRaw<ClaimRow[]>`
    SELECT id, license_id, organization_id, source_id, kind, attempts
      FROM knowledge_jobs_claim(${Math.ceil(options.leaseMs / 1000)}::int, ${options.maxAttempts}::int)`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    kind: row.kind as KnowledgeJobKind,
    context: { licenseId: row.license_id, organizationId: row.organization_id },
    attempts: row.attempts,
  };
}

/** The claim's row, as one `WHERE`: the job is this claim's only while it says so. */
export function jobFence(claim: KnowledgeJobClaim): Prisma.KnowledgeJobWhereInput {
  return { id: claim.id, status: 'running', attempts: claim.attempts };
}

/** What a job counts as it goes — `knowledge_jobs`' counters. */
export interface KnowledgeJobCounts {
  pagesDiscovered: number;
  pagesDone: number;
  pagesOk: number;
  pagesUnchanged: number;
  pagesSkipped: number;
  pagesFailed: number;
  pagesRemoved: number;
  bytesFetched: bigint;
}

/**
 * The job's progress and frontier, with its lease moved on, fenced. False:
 * the claim lost the job (cancelled, or taken over) — stop.
 */
export async function recordJobProgress(
  tx: TenantClient,
  claim: KnowledgeJobClaim,
  progress: { counts: KnowledgeJobCounts; frontier: FrontierEntry[]; leaseMs: number },
): Promise<boolean> {
  const { count } = await tx.knowledgeJob.updateMany({
    where: jobFence(claim),
    data: {
      ...progress.counts,
      frontier: progress.frontier as unknown as Prisma.InputJsonValue,
      leaseUntil: new Date(Date.now() + progress.leaseMs),
    },
  });
  return count > 0;
}

/** Move the lease on alone, fenced. False: the claim lost the job. */
export async function extendJobLease(
  db: PrismaClient,
  claim: KnowledgeJobClaim,
  leaseMs: number,
): Promise<boolean> {
  return withTenant(db, claim.context, async (tx) => {
    const { count } = await tx.knowledgeJob.updateMany({
      where: jobFence(claim),
      data: { leaseUntil: new Date(Date.now() + leaseMs) },
    });
    return count > 0;
  });
}

/**
 * How a claim ends: `done` (with a code when it stopped short — the job's
 * byte budget) / `failed` finish the job; `waiting_budget`
 * parks it until `availableAt` (the next UTC midnight) with its frontier,
 * and starts its attempts over — a wait is not a runner dying; `queued`
 * hands it back for the next claim (a runner stopping).
 */
export type JobEnd =
  | { status: 'done'; error?: string }
  | { status: 'failed'; error: string }
  | { status: 'waiting_budget'; availableAt: Date }
  | { status: 'queued'; availableAt?: Date };

/** End the claim, fenced. False: the claim had already lost the job. */
export async function endJobClaim(
  tx: TenantClient,
  claim: KnowledgeJobClaim,
  end: JobEnd,
): Promise<boolean> {
  const now = new Date();
  const data: Prisma.KnowledgeJobUpdateManyMutationInput =
    end.status === 'done' || end.status === 'failed'
      ? {
          status: end.status,
          leaseUntil: null,
          finishedAt: now,
          frontier: [],
          error: end.error ?? null,
        }
      : end.status === 'waiting_budget'
        ? { status: end.status, leaseUntil: null, availableAt: end.availableAt, attempts: 0 }
        : {
            status: end.status,
            leaseUntil: null,
            ...(end.availableAt ? { availableAt: end.availableAt } : {}),
          };
  const { count } = await tx.knowledgeJob.updateMany({ where: jobFence(claim), data });
  return count > 0;
}

/** Hand a claim back to the queue — a runner stopping — for the next claim to go on with. */
export async function releaseJobClaim(
  db: PrismaClient,
  claim: KnowledgeJobClaim,
): Promise<boolean> {
  return withTenant(db, claim.context, (tx) => endJobClaim(tx, claim, { status: 'queued' }));
}

/** 409 `knowledge_job_in_progress`: the source already has a job under way, named in `details.job_id`. */
export function knowledgeJobInProgress(jobId: string | null): ApiError {
  return new ApiError(
    'knowledge_job_in_progress',
    'This source already has a crawl under way; wait for it to finish or cancel it.',
    { details: { job_id: jobId } },
  );
}

/** Whether `error` is `knowledge_jobs_one_active_per_source` refusing a second job. */
function isActiveJobConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Queue a job for a source, inside the caller's tenant transaction. When the
 * source already has one under way, that one is returned with `created:
 * false` — the caller decides whether that is a 409 or the same answer.
 *
 * The existing job is looked for first: a refused insert would abort the
 * caller's transaction (Postgres), and the caller has more to write.
 */
export async function enqueueKnowledgeJob(
  tx: TenantClient,
  job: {
    context: TenantContext;
    sourceId: string;
    kind: KnowledgeJobKind;
    requestedBy: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const active = await tx.knowledgeJob.findFirst({
    where: { sourceId: job.sourceId, status: { in: [...KNOWLEDGE_JOB_ACTIVE_STATUSES] } },
    select: { id: true },
  });
  if (active) return { id: active.id, created: false };
  try {
    const created = await tx.knowledgeJob.create({
      data: {
        licenseId: job.context.licenseId,
        organizationId: job.context.organizationId,
        sourceId: job.sourceId,
        kind: job.kind,
        requestedBy: job.requestedBy,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    // Another request queued one between the read and the insert. The
    // transaction is spent; its caller's retry (or the client's) finds it.
    if (isActiveJobConflict(error)) throw knowledgeJobInProgress(null);
    throw error;
  }
}

/** The columns {@link serialiseKnowledgeJob} reads. */
export const KNOWLEDGE_JOB_SELECT = {
  id: true,
  sourceId: true,
  kind: true,
  status: true,
  pagesDiscovered: true,
  pagesDone: true,
  pagesOk: true,
  pagesUnchanged: true,
  pagesSkipped: true,
  pagesFailed: true,
  pagesRemoved: true,
  error: true,
  availableAt: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.KnowledgeJobSelect;

export type KnowledgeJobRow = Prisma.KnowledgeJobGetPayload<{
  select: typeof KNOWLEDGE_JOB_SELECT;
}>;

/** A job as the contract's `KnowledgeJob` says it. */
export function serialiseKnowledgeJob(job: KnowledgeJobRow): Record<string, unknown> {
  return {
    id: job.id,
    source_id: job.sourceId,
    kind: job.kind,
    status: job.status as KnowledgeJobStatus,
    pages: {
      discovered: job.pagesDiscovered,
      done: job.pagesDone,
      ok: job.pagesOk,
      unchanged: job.pagesUnchanged,
      skipped: job.pagesSkipped,
      failed: job.pagesFailed,
      removed: job.pagesRemoved,
    },
    error: job.error,
    available_at: job.availableAt.toISOString(),
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt ? job.startedAt.toISOString() : null,
    finished_at: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}
