/**
 * `app.backgroundMail` — mail a response must not wait for (tm 255.4).
 *
 * One instance per server, over the same mailer the routes use, so a test that
 * injects a mailer sees background sends land in it like any other. Drained on
 * close: a shutdown lets a reset email that is already on its way finish rather
 * than dropping it mid-conversation with the SMTP server. The carrier's own
 * per-command timeouts are what bound that wait.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Mailer } from '../services/mail/mailer.js';
import { BackgroundMail } from '../services/mail/delivery.js';

declare module 'fastify' {
  interface FastifyInstance {
    backgroundMail: BackgroundMail;
  }
}

async function backgroundMailPlugin(
  app: FastifyInstance,
  options: { mailer: Mailer },
): Promise<void> {
  const background = new BackgroundMail(options.mailer);
  app.decorate('backgroundMail', background);
  app.addHook('onClose', async () => {
    await background.settled();
  });
}

export default fp(backgroundMailPlugin, { name: 'background-mail' });
