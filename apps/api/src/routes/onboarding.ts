/**
 * First-run setup wizard (FR-MOD-00.4) + Reports survey popover (FR-MOD-07.2).
 *
 * A freshly signed-up workspace opens empty — no groups, no website, no
 * conversations. The first three endpoints back the wizard the new owner is
 * sent to: read the state, mark it done (finish or skip), and lay down sample
 * data. Both writes are workspace configuration, so they take the tenant-wide
 * `properties.configuration:rw` scope (which only owners and admins hold) *and*
 * an explicit role check — both gates, as everywhere else: the scope says the
 * token may, the role says the person may.
 *
 * `/onboarding/survey` is a different shape on purpose: it is a personalization
 * signal, not configuration, so it takes the same `reports_read` gate Reports
 * itself does rather than the admin-only scope above — whoever can open
 * Reports and be shown the popover can also answer or skip it.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ONBOARDING_SURVEY_ANSWERS, type AgentRole } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { type AgentPrincipal, roleAtLeast } from '../services/auth/principal.js';
import { OnboardingService } from '../services/onboarding/onboarding-service.js';

const surveyBody = z.object({
  answer: z.enum(ONBOARDING_SURVEY_ANSWERS).nullable(),
});

function parseSurveyBody(value: unknown): z.infer<typeof surveyBody> {
  const result = surveyBody.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  const onboarding = new OnboardingService();

  app.get('/onboarding/state', { config: { principals: ['agent'] } }, async (request, reply) => {
    const tenant = request.tenant();
    const state = await request.withTenant((tx) => onboarding.getState(tx, tenant.licenseId));
    return reply.send(state);
  });

  app.post(
    '/onboarding/survey',
    { config: { principals: ['agent'], scopes: ['reports_read'] } },
    async (request, reply) => {
      const body = parseSurveyBody(request.body);
      const tenant = request.tenant();
      const state = await request.withTenant((tx) =>
        onboarding.answerSurvey(tx, tenant.licenseId, body.answer),
      );
      return reply.send(state);
    },
  );

  app.post(
    '/onboarding/complete',
    { config: { scopes: ['properties.configuration:rw'] } },
    async (request, reply) => {
      requireAdmin(request);
      const tenant = request.tenant();
      const state = await request.withTenant((tx) => onboarding.complete(tx, tenant.licenseId));
      return reply.send(state);
    },
  );

  app.post(
    '/onboarding/seed-demo',
    { config: { scopes: ['properties.configuration:rw'] } },
    async (request, reply) => {
      const principal = requireAdmin(request);
      const tenant = request.tenant();
      const result = await request.withTenant((tx) =>
        onboarding.seedDemo(tx, tenant, principal.accountId),
      );
      return reply.send(result);
    },
  );
}

/**
 * The scope already restricts these to admin+ tokens, but the role is checked
 * too so a broadly-scoped token cannot let an agent-role user set up the
 * workspace on their behalf.
 */
function requireAdmin(request: FastifyRequest): AgentPrincipal {
  const principal = request.requirePrincipal();
  if (principal.kind !== 'agent' || !roleAtLeast(principal.role as AgentRole, 'admin')) {
    throw ApiError.authorization('Only an admin or owner can set up the workspace.');
  }
  return principal;
}
