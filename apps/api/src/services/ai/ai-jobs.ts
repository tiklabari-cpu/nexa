/**
 * The durable AI job queue's two doors (tm 289.1 · ADR-11a · SiyahTuş analysis
 * GV-02).
 *
 * The reply a visitor message is owed waits in `ai_jobs` rather than in
 * process memory, so a restart no longer loses it. The table's state moves
 * only through two SECURITY DEFINER functions (migration 20261016120000), and
 * these are their typed callers:
 *
 *   - {@link claimAiJobs} — the worker's one cross-tenant read, like
 *     `retention_list_tenants()` is the sweeps' (`webhooks/redelivery.ts`).
 *     Takes due jobs under `FOR UPDATE SKIP LOCKED` and leases them; one chat
 *     at a time, oldest first, so a chat's replies are produced in the order
 *     its messages arrived even across several API processes. A job whose
 *     worker died is taken again once its lease runs out.
 *   - {@link settleAiJob} — records the result inside the job's tenant,
 *     ideally in the transaction that writes the reply. Fenced by the attempt
 *     number the claim handed out: once a lease runs out and someone else
 *     re-claims the job, the first worker's settle changes nothing.
 *
 * What neither of them does: decide whether a job should still run (freshness,
 * eligibility, "has this message been answered already") — that is the
 * worker's (tm 289.3). The fence stops a stale worker from *recording* a
 * result; only the idempotency check before sending stops it from *sending*
 * one (ADR-11a §2.6).
 */
import type { PrismaClient } from '@prisma/client';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/** `ai_jobs_kind_check`. One kind for now (ADR-11a §2.9). */
export const AI_JOB_KINDS = ['visitor_message'] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

/** `ai_jobs_state_check`. */
export const AI_JOB_STATES = ['pending', 'running', 'done', 'expired', 'failed'] as const;
export type AiJobState = (typeof AI_JOB_STATES)[number];

/** How many times a job may run the model (ADR-11a §2.2). */
export const AI_JOB_MAX_ATTEMPTS = 2;

/** `ai_jobs_outcome_check`: a code, never conversation text. */
export const AI_JOB_OUTCOME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** The claim function's own bounds; outside them it raises. */
export const AI_JOB_CLAIM_MAX_LIMIT = 100;
export const AI_JOB_MAX_LEASE_MS = 3_600_000;
export const AI_JOB_MAX_RETRY_AFTER_MS = 3_600_000;

/** A job this worker now holds. */
export interface AiJobClaim {
  id: string;
  /** The job's tenant: run it, and settle it, inside `withTenant(db, context, …)`. */
  context: TenantContext;
  /** The day container (panel "Thread ID"). */
  chatId: string;
  /** The connection (panel "Chat ID"). */
  threadId: string;
  triggerEventId: string;
  kind: AiJobKind;
  /** This claim's number — pass it back to {@link settleAiJob}. */
  attempts: number;
  createdAt: Date;
  /** The request that enqueued the job, for its log lines. */
  requestId: string | null;
  /**
   * Every allowed attempt has been used up by a worker that stopped before
   * settling. This pass must not run the model again: hand the conversation
   * to a human and settle `failed`. If it stops too, the next claim fails the
   * job by itself.
   */
  exhausted: boolean;
}

export interface ClaimAiJobsOptions {
  /** At most this many jobs (1 … {@link AI_JOB_CLAIM_MAX_LIMIT}). */
  limit: number;
  /** How long the claim holds each job; rounded up to whole seconds. */
  leaseMs: number;
  maxAttempts?: number;
}

/** How a claim ended. `pending` hands the job back to be claimed again. */
export type AiJobResult =
  | { state: 'done' | 'expired' | 'failed'; outcome: string; error?: string | null }
  | { state: 'pending'; outcome?: string | null; error?: string | null; retryAfterMs?: number };

interface ClaimRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  chat_id: string;
  thread_id: string;
  trigger_event_id: string;
  kind: AiJobKind;
  attempts: number;
  created_at: Date;
  request_id: string | null;
}

/**
 * Take up to `limit` due jobs, oldest first, at most one per chat. Runs
 * outside any tenant context — the job's own context comes back with it.
 */
export async function claimAiJobs(
  db: PrismaClient,
  options: ClaimAiJobsOptions,
): Promise<AiJobClaim[]> {
  const maxAttempts = options.maxAttempts ?? AI_JOB_MAX_ATTEMPTS;
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > AI_JOB_CLAIM_MAX_LIMIT
  ) {
    throw new RangeError(`claimAiJobs: limit must be 1 … ${AI_JOB_CLAIM_MAX_LIMIT}`);
  }
  if (
    !Number.isFinite(options.leaseMs) ||
    options.leaseMs <= 0 ||
    options.leaseMs > AI_JOB_MAX_LEASE_MS
  ) {
    throw new RangeError(`claimAiJobs: leaseMs must be in (0, ${AI_JOB_MAX_LEASE_MS}]`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError('claimAiJobs: maxAttempts must be 1 … 10');
  }
  const leaseSeconds = Math.ceil(options.leaseMs / 1000);

  const rows = await db.$queryRaw<ClaimRow[]>`
    SELECT id, license_id, organization_id, chat_id, thread_id, trigger_event_id,
           kind, attempts, created_at, request_id
      FROM ai_jobs_claim(${options.limit}::int, ${leaseSeconds}::int, ${maxAttempts}::int)`;

  return rows.map((row) => ({
    id: row.id,
    context: { licenseId: row.license_id, organizationId: row.organization_id },
    chatId: row.chat_id,
    threadId: row.thread_id,
    triggerEventId: row.trigger_event_id,
    kind: row.kind,
    attempts: row.attempts,
    createdAt: row.created_at,
    requestId: row.request_id,
    exhausted: row.attempts > maxAttempts,
  }));
}

/**
 * Record how `job`'s claim ended. `tx` must be the job's tenant (the function
 * refuses a call without one, and does not see another tenant's job).
 *
 * Returns false when the claim no longer holds the job — its lease ran out
 * and another worker took it, or it was already settled. The caller then has
 * nothing to record; whatever it did is the newer claim's to account for.
 */
export async function settleAiJob(
  tx: TenantClient,
  job: Pick<AiJobClaim, 'id' | 'attempts'>,
  result: AiJobResult,
): Promise<boolean> {
  const outcome = result.outcome ?? null;
  if (outcome !== null && !AI_JOB_OUTCOME_RE.test(outcome)) {
    throw new RangeError(`settleAiJob: outcome must match ${String(AI_JOB_OUTCOME_RE)}`);
  }
  const retryAfterMs = result.state === 'pending' ? (result.retryAfterMs ?? 0) : 0;
  if (
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0 ||
    retryAfterMs > AI_JOB_MAX_RETRY_AFTER_MS
  ) {
    throw new RangeError(`settleAiJob: retryAfterMs must be 0 … ${AI_JOB_MAX_RETRY_AFTER_MS}`);
  }
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

  const rows = await tx.$queryRaw<Array<{ settled: boolean }>>`
    SELECT ai_jobs_settle(${job.id}::uuid, ${job.attempts}::int, ${result.state}::text,
                          ${outcome}::text, ${result.error ?? null}::text,
                          ${retryAfterSeconds}::int) AS settled`;
  return rows[0]?.settled === true;
}
