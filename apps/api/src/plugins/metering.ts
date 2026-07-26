/**
 * API-call metering (FR-MOD-10.1.5).
 *
 * Every successful call a server integration makes with a Personal Access Token
 * is a billed API call (the PRD's "Faturalanan API çağrısı"; FR-MOD-08.8.2 pairs
 * the counter with PATs). Counted here as a hook rather than per route, for the
 * same reason authorization is: "we forgot to meter that one endpoint" is how a
 * metered plan quietly stops metering.
 *
 * What is *not* metered, by design:
 *  - the agent console (OAuth tokens) and AI bots (bot tokens) — these are the
 *    product using itself, not a customer's integration calling the API;
 *  - the widget (customer tokens) — a visitor is never billed;
 *  - server errors (5xx) — a customer is not charged for our faults.
 *
 * Metered in `onSend` (awaited before the response is written) rather than
 * `onResponse` (fire-and-forget after): the counter is the invoice's number, so
 * it is worth a single local upsert on the way out to make it strongly
 * consistent and never lose a call. The write is still best-effort — a metering
 * hiccup must never turn a served API call into a failed one — so any error is
 * logged and swallowed, and the response goes out unchanged.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { recordApiCall } from '../services/billing/metering.js';

async function meteringPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const { env } = options;

  app.addHook('onSend', async (request, reply, payload) => {
    const principal = request.principal;
    // Only a Personal Access Token counts as a billed API call. `tokenKind` is
    // absent on customer principals and 'oauth'/'bot' on the others, so this one
    // check excludes the console, the bots and the widget at once.
    if (!principal || principal.kind !== 'agent' || principal.tokenKind !== 'pat') return payload;
    // Do not bill our own faults; a 5xx is not a served call.
    if (reply.statusCode >= 500) return payload;

    try {
      await request.withTenant((tx) =>
        recordApiCall(tx, request.tenant(), env.API_CALL_OVERAGE_CENTS, env.API_CALLS_INCLUDED),
      );
    } catch (error) {
      // Best-effort: a metering failure must not fail the call it is metering.
      request.log.warn({ err: error }, 'api-call metering failed');
    }

    // Payload returned unchanged — this hook counts, it never rewrites.
    return payload;
  });
}

export default fp(meteringPlugin, { name: 'metering', dependencies: ['auth', 'database'] });
