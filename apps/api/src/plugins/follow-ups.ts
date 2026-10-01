/**
 * `app.followUps` — what a visitor's message sets off after its response
 * (tm 256.10): the rule bot, the AI Agent and the assignee's notice.
 *
 * One instance per server. Drained on close, and registered after `database`,
 * `redis` and `background-mail` so that — `onClose` hooks running in reverse
 * registration order — the drain runs while the pool, the publisher's Redis
 * and the mail queue the jobs write to are all still open. Fastify closes the
 * listener and lets in-flight requests finish before any `onClose` hook, so a
 * job a last request hands in is drained too.
 *
 * The wait is bounded by the shutdown's own ceiling (`lib/shutdown.ts`
 * `CLOSE_TIMEOUT_MS`), as a request that was still waiting on the model was
 * before; a job the ceiling cuts off leaves its message unanswered for a human.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FollowUps } from '../services/chat/follow-ups.js';

declare module 'fastify' {
  interface FastifyInstance {
    followUps: FollowUps;
  }
}

async function followUpsPlugin(app: FastifyInstance): Promise<void> {
  const followUps = new FollowUps({
    onError: (error, key) => app.log.error({ err: error, key }, 'visitor follow-up failed'),
  });
  app.decorate('followUps', followUps);
  app.addHook('onClose', async () => {
    if (followUps.size > 0) {
      // Says why a shutdown is taking its time — up to a model call per chat.
      app.log.info({ pending: followUps.size }, 'waiting for visitor follow-ups');
    }
    await followUps.settled();
  });
}

export default fp(followUpsPlugin, {
  name: 'follow-ups',
  dependencies: ['database', 'redis', 'background-mail'],
});
