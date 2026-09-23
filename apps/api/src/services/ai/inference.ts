/**
 * Where model inference is allowed to happen (NFR-C4 · C4-e).
 *
 * A workspace declares the region its data lives in and can never move (C4-a),
 * and every door refuses a request that arrives at the wrong one (C4-b). Both of
 * those are about *storage and access*. Neither says anything about the moment a
 * conversation is handed to a model — and that is the moment a transcript most
 * easily crosses a border, because a model provider is a third party in some
 * other country by default. A workspace with a signed BAA whose chats are
 * summarised in another region has a residency guarantee on paper and not in
 * fact; that account is exactly what C4-e exists to make impossible.
 *
 * **The gate came before the provider.** For a long time `LLM_PROVIDER` had only
 * one value (`mock`, an in-process deterministic stub — CLAUDE.md's external
 * services rule). It was read here, together with the region that provider
 * answers in, because the gate had to exist *before* a real provider was
 * configured: a gate added afterwards is a gate added after the first request
 * went out. tm 255.5 opened the enum to `openai` behind `createLlmProvider`
 * (`services/ai/provider/`); this rule did not change, and every caller still
 * passes it before any provider is reached.
 *
 * **The constraint is HIPAA scope, not region.** Out-of-region inference is a
 * legitimate configuration for an uncovered workspace — that is what the mock
 * stub effectively is in a single-deployment setup, and the negative case is
 * part of the requirement: a workspace without a BAA is not silently subjected
 * to a rule it never agreed to. Scope is what turns the same configuration into
 * a refusal.
 *
 * **Two providers, one rule (tm 255.7).** Embedding a customer's question sends
 * it to the embedding provider before any model sees it, so that provider is
 * held to the same boundary under its own key (`EMBEDDING_PROVIDER_REGION`,
 * ADR §7). The request gate (`plugins/ai-residency.ts`) refuses a covered
 * workspace when *either* provider would take its content out of region; work
 * that no request carries — the freshness sweep, `knowledge:reembed` — asks
 * {@link readInferenceResidency} for the same two facts a request carries.
 */
import { REGIONS, servesRegion, type Region } from '@nexa/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { readHipaaScope } from '../../lib/hipaa.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export interface InferenceProvider {
  /** Which implementation answers — the value `LLM_PROVIDER` or `EMBEDDING_PROVIDER` names. */
  id: Env['LLM_PROVIDER'] | Env['EMBEDDING_PROVIDER'];
  /** Where that implementation physically runs the inference. */
  region: Region;
}

/**
 * The provider this deployment would use, resolved once at boot.
 *
 * The region defaults to the process's own, which is the truth for an in-process
 * stub: it runs wherever the API runs. `LLM_PROVIDER_REGION` exists so a
 * deployment that points at a model service elsewhere has to *say so*, rather
 * than the default quietly asserting something false about a remote endpoint.
 */
export function resolveInferenceProvider(
  env: Pick<Env, 'LLM_PROVIDER' | 'LLM_PROVIDER_REGION' | 'NEXA_REGION'>,
): InferenceProvider {
  return { id: env.LLM_PROVIDER, region: env.LLM_PROVIDER_REGION ?? env.NEXA_REGION };
}

/**
 * The embedding provider, resolved on {@link resolveInferenceProvider}'s terms
 * (tm 255.7): the process's own region unless `EMBEDDING_PROVIDER_REGION` says
 * otherwise, which production requires it to for anything but the stub.
 */
export function resolveEmbeddingInferenceProvider(
  env: Pick<Env, 'EMBEDDING_PROVIDER' | 'EMBEDDING_PROVIDER_REGION' | 'NEXA_REGION'>,
): InferenceProvider {
  return {
    id: env.EMBEDDING_PROVIDER,
    region: env.EMBEDDING_PROVIDER_REGION ?? env.NEXA_REGION,
  };
}

/**
 * A workspace's residency facts, read inside its own tenant context — for work
 * that no request carries and so no credential has already resolved (tm 255.7).
 *
 * `null` when the region cannot be read or is not one this build knows. The
 * callers treat that as a refusal: a gate that cannot establish where a
 * workspace lives has no business sending its content anywhere.
 */
export async function readInferenceResidency(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<{ region: Region; hipaaScope: boolean } | null> {
  const organization = await tx.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { region: true },
  });
  const region = REGIONS.find((candidate) => candidate === organization?.region);
  if (!region) return null;
  return { region, hipaaScope: await readHipaaScope(tx, tenant.licenseId) };
}

/**
 * Whether running inference for this workspace on this provider would take its
 * content out of the region it lives in. Independent of scope, because the
 * caller uses it to decide whether the (more expensive) scope lookup is worth
 * making at all.
 */
export function inferenceLeavesRegion(
  provider: InferenceProvider,
  workspaceRegion: Region,
): boolean {
  return !servesRegion(provider.region, workspaceRegion);
}

export interface InferenceDecision {
  provider: InferenceProvider;
  /** The region the workspace's data lives in — from the credential (C4-b). */
  workspaceRegion: Region;
  /** Whether the workspace is covered by a signed BAA (`lib/hipaa.ts`). */
  hipaaScope: boolean;
}

/** The whole rule, in one place, so the three call sites cannot disagree. */
export function inferenceAllowed(decision: InferenceDecision): boolean {
  if (!decision.hipaaScope) return true;
  return !inferenceLeavesRegion(decision.provider, decision.workspaceRegion);
}

/**
 * Refuse an inference that would leave a covered workspace's region.
 *
 * `not_allowed` (403), not `misdirected_request` (421). 421 says "you are at the
 * wrong address, here is the right one", and the caller is not: they reached the
 * region that holds their workspace, which is where they should be. What is out
 * of place is this deployment's model provider, and no address the client could
 * retry against would fix it — it is an operator's configuration. Saying 421
 * would send a correctly-addressed client hunting for a door that does not
 * exist. The details name both regions because the person who can act on this
 * reads them in a log, not in a client.
 */
export function assertInferenceAllowed(decision: InferenceDecision): void {
  if (inferenceAllowed(decision)) return;
  throw new ApiError(
    'not_allowed',
    'This workspace is covered by a signed HIPAA agreement, so its content cannot be sent to a model outside its region. No AI feature is available here until the deployment uses an in-region provider.',
    {
      details: {
        region: decision.workspaceRegion,
        provider_region: decision.provider.region,
      },
    },
  );
}
