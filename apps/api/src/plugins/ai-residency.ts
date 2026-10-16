/**
 * The AI half of HIPAA scope (NFR-C4 · C4-e).
 *
 * A route that runs model inference over workspace content declares
 * `config: { aiInference: true }`, and this refuses it when the workspace is
 * covered by a signed BAA and the configured provider would take that content
 * out of its region. The rule itself lives in `services/ai/inference.ts`; this
 * is where a request meets it.
 *
 * Declared per route and enforced in a hook, for the reason the license gate
 * gives: "we forgot to gate that one endpoint" is how a guarantee stops being
 * one, and the AI surface is six handlers across three files plus a service that
 * runs on the customer's own message. The same check is reachable directly as
 * `request.requireAiInference()` for that last caller, which is not a route.
 *
 * **It costs nothing in a normal deployment.** The provider region is resolved
 * once at boot and compared against a region the auth plugin already put on the
 * request; only when those differ does anything query the database. So the
 * ordinary case — an in-process stub in the region it serves — is two string
 * comparisons, and the lookup happens exactly in the configuration that needs
 * deciding.
 *
 * **Both providers (tm 255.7).** Content reaches the embedding provider as well
 * as the model — a customer's question is embedded before anything answers it,
 * an uploaded article is embedded to be indexed — so the check covers both, and
 * a covered workspace is refused when either would carry its content out of
 * region. The surface is gated as one, as it always was: `/skills/compile`
 * calls neither provider today and is still refused, because the refusal
 * message promises "no AI feature" and a per-route list of which provider each
 * handler happens to reach would be the list somebody forgets to update. The
 * audit entry names the provider that tripped it (`provider_kind`).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Region } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { readHipaaScope } from '../lib/hipaa.js';
import { type TenantContext, withTenant } from '../lib/tenant.js';
import { type AuditContext, writeAuditEntry } from '../services/audit/audit-log.js';
import {
  assertInferenceAllowed,
  inferenceLeavesRegion,
  resolveEmbeddingInferenceProvider,
  resolveInferenceProvider,
} from '../services/ai/inference.js';

/** Who is about to send a workspace's content to a model, when it is not a request. */
export interface AiInferenceCaller {
  tenant: TenantContext;
  /** The workspace's own region (`organizations.region`). */
  region: Region;
  /** The refusal's audit context — built only when a refusal is recorded. */
  auditContext: () => AuditContext;
  /** What asked, for the audit entry: a route, or the job that runs the AI. */
  route: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Throw unless this workspace may have its content inferred by the
     * configured provider. Resolves once per call; cheap when the provider is
     * in region.
     */
    requireAiInference: () => Promise<void>;
  }

  interface FastifyInstance {
    /**
     * The same check for a caller that is not a request — the AI job worker,
     * answering a visitor's message after its response (tm 289.5).
     */
    requireAiInference: (caller: AiInferenceCaller) => Promise<void>;
  }

  interface FastifyContextConfig {
    /**
     * This route sends workspace content to a model. Marks it for the residency
     * check — not a permission, a data-boundary declaration.
     */
    aiInference?: boolean;
  }
}

async function aiResidencyPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  // The model first: when both are out of region, the entry names the one
  // this gate has always reported.
  const providers = [
    { kind: 'llm', ...resolveInferenceProvider(options.env) },
    { kind: 'embedding', ...resolveEmbeddingInferenceProvider(options.env) },
  ] as const;

  app.decorate('requireAiInference', async (caller: AiInferenceCaller): Promise<void> => {
    const workspaceRegion = caller.region;

    // The common case, and deliberately first: in-region providers raise no
    // question for anyone, covered or not, so nothing is read and nothing is
    // recorded.
    const provider = providers.find((candidate) =>
      inferenceLeavesRegion(candidate, workspaceRegion),
    );
    if (!provider) return;

    const licenseId = caller.tenant.licenseId;
    const hipaaScope = await withTenant(app.db, caller.tenant, (tx) =>
      readHipaaScope(tx, licenseId),
    );
    // The negative half of the requirement, and it is a feature rather than an
    // omission: a workspace that never signed a BAA keeps working exactly as it
    // did. The constraint arrives with the agreement, not with the deployment.
    if (!hipaaScope) return;

    // Recorded before the refusal is thrown, and recorded at all because this is
    // the question an auditor actually asks — not "is it configured correctly"
    // but "did anything covered ever go out". A gate with no trail can only
    // answer the first. The entry names the two regions and the provider; the
    // content that was about to be sent is, of course, not in it.
    //
    // One row per refusal, including the customer-message path, which can mean
    // one per inbound message while the deployment stays misconfigured. That is
    // the intended volume: this state is an operator error that should be
    // impossible to miss, and a compliance trail that samples is a compliance
    // trail that cannot answer the question it exists for.
    await withTenant(app.db, caller.tenant, (tx) =>
      writeAuditEntry(tx, caller.auditContext(), {
        action: 'compliance.ai_region_blocked',
        target: `license:${licenseId}`,
        metadata: {
          region: workspaceRegion,
          provider_region: provider.region,
          provider: provider.id,
          provider_kind: provider.kind,
          route: caller.route,
        },
      }),
    );

    assertInferenceAllowed({ provider, workspaceRegion, hipaaScope });
  });

  app.decorateRequest('requireAiInference', async function (this: FastifyRequest): Promise<void> {
    const region = this.requireRegion();
    await app.requireAiInference({
      tenant: this.tenant(),
      region,
      auditContext: () => this.auditContext(),
      route: this.routeOptions.url ?? this.url,
    });
  });

  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (!request.routeOptions.config.aiInference) return;
    // No principal means a public route, and none of these are: the check needs
    // a workspace to be about. Authentication has already refused anyone else.
    if (!request.principal) return;
    await request.requireAiInference();
  });
}

export default fp(aiResidencyPlugin, { name: 'ai-residency', dependencies: ['auth', 'audit'] });
