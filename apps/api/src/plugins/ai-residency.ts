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
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { readHipaaScope } from '../lib/hipaa.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  assertInferenceAllowed,
  inferenceLeavesRegion,
  resolveInferenceProvider,
} from '../services/ai/inference.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Throw unless this workspace may have its content inferred by the
     * configured provider. Resolves once per call; cheap when the provider is
     * in region.
     */
    requireAiInference: () => Promise<void>;
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
  const provider = resolveInferenceProvider(options.env);

  app.decorateRequest('requireAiInference', async function (this: FastifyRequest): Promise<void> {
    const workspaceRegion = this.requireRegion();

    // The common case, and deliberately first: an in-region provider raises no
    // question for anyone, covered or not, so nothing is read and nothing is
    // recorded.
    if (!inferenceLeavesRegion(provider, workspaceRegion)) return;

    const licenseId = this.tenant().licenseId;
    const hipaaScope = await this.withTenant((tx) => readHipaaScope(tx, licenseId));
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
    await this.withTenant((tx) =>
      writeAuditEntry(tx, this.auditContext(), {
        action: 'compliance.ai_region_blocked',
        target: `license:${licenseId}`,
        metadata: {
          region: workspaceRegion,
          provider_region: provider.region,
          provider: provider.id,
          route: this.routeOptions.url ?? this.url,
        },
      }),
    );

    assertInferenceAllowed({ provider, workspaceRegion, hipaaScope });
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
