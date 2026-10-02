/**
 * The daily AI caps at the door (tm 257.8 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(3)).
 *
 * A route whose handler asks a model to write declares
 * `config: { aiBudget: true }`, and this refuses it with 429 `limit_reached`
 * (`details.reason: 'ai_daily_cap'`, `Retry-After` to UTC midnight) when the
 * workspace's or the deployment's allowance for today could not fit even the
 * smallest call — before the handler reads a conversation or builds a prompt.
 * The visitor's path, which is not a route of its own, asks the same question
 * through `request.requireAiBudget()` (`services/ai/ai-responder.ts`).
 *
 * **This is the early answer, not the cap.** The cap is the reservation each
 * model call makes (`services/ai/metered-llm.ts`); a call that passes here and
 * then does not fit is refused there with the same error. What this adds is
 * that a capped workspace spends nothing — no embedding of the visitor's
 * question, no transcript read — on work that cannot finish.
 *
 * **Its own flag, not `aiInference`.** The residency flag also marks routes
 * that call no model (`/skills/compile`, the command palette, the BI command:
 * deterministic, free), and does not reach the visitor's path at all. A cap
 * tied to it would refuse free features and miss the one surface strangers
 * can drive. Declared on the routes that call a model: Preview, the Copilot
 * summary and rewrite.
 *
 * **Free when nothing is counted.** With the `mock` provider (every suite, dev
 * and e2e) there is nothing to cap and no query is made.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AiDailyBudget } from '../services/ai/ai-daily-budget.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Throw `AiDailyCapError` unless a model call could still fit today's caps
     * for this workspace. A no-op when no provider is counted.
     */
    requireAiBudget: () => Promise<void>;
  }

  interface FastifyContextConfig {
    /** This route asks a model to write — refuse it while today's AI cap is reached. */
    aiBudget?: boolean;
  }
}

export interface AiBudgetPluginOptions {
  budget: AiDailyBudget;
  /** Whether any model this server calls is counted — false on `mock`. */
  metered: boolean;
  /**
   * The smallest call any model surface makes, in estimated tokens: the
   * reply's ceiling, `LLM_MAX_OUTPUT_TOKENS`. Every estimate is that plus a
   * prompt, so refusing below it never turns away a call that would fit.
   */
  minimum: number;
}

async function aiBudgetPlugin(app: FastifyInstance, options: AiBudgetPluginOptions): Promise<void> {
  const { budget, metered, minimum } = options;

  app.decorateRequest('requireAiBudget', async function (this: FastifyRequest): Promise<void> {
    if (!metered) return;
    await budget.check(this.tenant(), 'llm', minimum);
  });

  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (!request.routeOptions.config.aiBudget) return;
    // None of the flagged routes is public; authentication has already refused
    // a caller without a principal, and there is no workspace to count.
    if (!request.principal) return;
    await request.requireAiBudget();
  });
}

export default fp(aiBudgetPlugin, { name: 'ai-budget', dependencies: ['auth'] });
