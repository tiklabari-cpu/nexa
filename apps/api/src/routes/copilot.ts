/**
 * Copilot — the agent-assist surface (FR-MOD-12).
 *
 * Two families of route, one boundary. The knowledge routes (12.2) manage the
 * copilot-only knowledge base — a base kept apart from the customer-facing AI
 * agent's, and never reachable by a customer token (the default `principals` of
 * agent+bot turn a customer's request into a 404 before it reaches a handler).
 * The chat routes (12.3) are the in-conversation assists: a summary that lands
 * as an internal note, a reply drafted from the copilot base, and a tone/grammar
 * rewrite. Every assist records a run so Reports counts the chat as "assisted".
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hasAnyScope, isShortId } from '@nexa/types';
import { ENHANCE_MODES, enhanceText, summariseConversation } from '@nexa/ai-mock';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { assertPublicHttpUrl } from '../lib/ssrf.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { scopesOf } from '../services/auth/principal.js';
import { CopilotService } from '../services/ai/copilot-service.js';
import { KnowledgeService } from '../services/ai/knowledge-service.js';
import { crawl } from '../services/ai/web-crawler.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';

/** Copilot knowledge is configured like the AI agent's — same bot scope. */
const KB_READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const KB_WRITE = ['agents-bot--all:rw'];
/** An assist acts on a conversation, so it needs write access to chats. */
const CHAT_WRITE = ['chats--all:rw', 'chats--access:rw'];

/**
 * The BI command (12.4) is authorised by the **union** of two permissions, not
 * either one: it is a Copilot surface, so it needs the Copilot scope, and every
 * word of its answer is report data, so it needs `reports_read` as well.
 *
 * The union has to be spelled in two places because `config.scopes` is
 * deliberately any-of (see the auth plugin) — listing both there would grant
 * access to a caller holding *either*, which is the opposite of what this
 * endpoint means. So the route gate proves the caller may use Copilot, and the
 * handler proves they may read reports. Narrowest of the two wins, either way
 * round: a Copilot token cannot use this to read figures `reports_read` would
 * have refused it, and a reports token cannot reach a Copilot endpoint it was
 * never given.
 */
const BI_COPILOT = KB_READ;
const BI_REPORTS = ['reports_read'];

const uuid = z.string().uuid();
const chatIdSchema = z.string().refine(isShortId, 'not a valid chat id');

/**
 * A website source is crawled from a URL; every other type indexes pasted text.
 * Exactly one of `source_url` (website) or `content` (the rest) is required.
 */
const createSourceBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(100_000).optional(),
    source_url: z.string().trim().min(1).max(2048).optional(),
    type: z.enum(['website', 'file', 'article', 'faq']).default('article'),
  })
  .superRefine((body, ctx) => {
    if (body.type === 'website') {
      if (!body.source_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source_url'],
          message: 'a website source needs a URL to crawl',
        });
      }
    } else if (!body.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is required',
      });
    }
  });

const enhanceBody = z.object({
  text: z.string().trim().min(1).max(10_000),
  mode: z.enum(ENHANCE_MODES).default('rephrase'),
});

/**
 * 500 characters, the cap the contract publishes (NFR-S8). A question is one
 * sentence; anything longer is either a paste or an attempt to make the matcher
 * do unbounded work, and both are refused in the request rather than absorbed.
 */
const biBody = z.object({
  question: z.string().trim().min(1).max(500),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function copilotRoutes(
  app: FastifyInstance,
  { env }: { env: Env },
): Promise<void> {
  const knowledge = new KnowledgeService();
  const copilot = new CopilotService(knowledge);
  const chats = new ChatService(
    app.db,
    app.redis,
    new RealtimePublisher(app.redis, app.log),
    undefined,
    {
      aiOverageCents: env.AI_OVERAGE_CENTS,
      aiIncluded: env.AI_RESOLUTIONS_INCLUDED,
    },
  );

  // --- Knowledge (12.2) ------------------------------------------------------

  app.get('/copilot/knowledge', { config: { scopes: KB_READ } }, async (request, reply) => {
    const items = await request.withTenant((tx) => copilot.listSources(tx));
    return reply.send({ items });
  });

  // `aiInference`, unlike the list above it: saving a source chunks and embeds
  // its text, which is a model call over workspace content (NFR-C4 · C4-e).
  app.post(
    '/copilot/knowledge',
    { config: { scopes: KB_WRITE, aiInference: true } },
    async (request, reply) => {
      const body = parse(createSourceBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      // A website is crawled before the transaction: the SSRF guard rejects a
      // private/internal target with a 400 (the URL never reaches a fetcher), and
      // the fetch+parse has no business holding a DB row open.
      let content = body.content ?? '';
      let sourceUrl: string | null = null;
      if (body.type === 'website') {
        const url = assertPublicHttpUrl(body.source_url ?? '');
        const page = await crawl(url);
        content = page.text;
        sourceUrl = url.toString();
      }

      const source = await request.withTenant((tx) =>
        copilot.createSource(tx, tenant, principal, {
          type: body.type,
          name: body.name,
          content,
          sourceUrl,
        }),
      );
      return reply.status(201).send(source);
    },
  );

  app.delete<{ Params: { sourceId: string } }>(
    '/copilot/knowledge/:sourceId',
    { config: { scopes: KB_WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.sourceId);
      const deleted = await request.withTenant(async (tx) => {
        const count = await copilot.deleteSource(tx, id);
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `copilot_source:${id}`,
            metadata: { kind: 'copilot_source' },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Knowledge source not found.');
      return reply.status(204).send();
    },
  );

  // --- Assist (12.3) ---------------------------------------------------------

  app.post<{ Params: { chatId: string } }>(
    '/copilot/chats/:chatId/summary',
    { config: { scopes: CHAT_WRITE, aiInference: true } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const turns = await request.withTenant((tx) => copilot.conversationTurns(tx, chatId));
      const summary = summariseConversation(turns);

      // The summary lands as an internal note through the same path the composer
      // uses, so it fans out over RTM and is filtered from the customer on read.
      // sendEvent enforces visibility and rejects an archived chat, so an assist
      // can never write into a conversation the agent cannot see.
      const { event } = await chats.sendEvent(tenant, principal, chatId, {
        type: 'message',
        text: summary,
        recipients: 'agents',
      });

      await request.withTenant((tx) =>
        copilot.recordAssist(tx, tenant, chatId, 'summary', summary),
      );

      return reply.status(201).send({ summary, note_event_id: event.id });
    },
  );

  app.post<{ Params: { chatId: string } }>(
    '/copilot/chats/:chatId/reply',
    { config: { scopes: CHAT_WRITE, aiInference: true } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      // Gate on visibility the same way the chat routes do — a scoped agent
      // cannot draft from a conversation their team was never given.
      await chats.get(tenant, principal, chatId);

      const result = await request.withTenant(async (tx) => {
        const draft = await copilot.draftReply(tx, tenant, chatId);
        // Only a draft that found something counts as an assist — an empty
        // suggestion helped no one and should not flip the chat to "assisted".
        if (draft.draft) await copilot.recordAssist(tx, tenant, chatId, 'reply', draft.draft);
        return draft;
      });

      return reply.send(result);
    },
  );

  app.post<{ Params: { chatId: string } }>(
    '/copilot/chats/:chatId/enhance',
    { config: { scopes: CHAT_WRITE, aiInference: true } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const body = parse(enhanceBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      await chats.get(tenant, principal, chatId);
      const text = enhanceText(body.text, body.mode);

      await request.withTenant((tx) =>
        copilot.recordAssist(tx, tenant, chatId, 'enhance', body.mode),
      );

      return reply.send({ text, mode: body.mode });
    },
  );

  // --- BI command (12.4) -----------------------------------------------------

  /**
   * Answer a report/metric question about this workspace's own activity.
   *
   * Boundary shape, in the order it is enforced: a customer token is turned away
   * by the default agent+bot `principals` list before a handler runs (a 404, not
   * a 403 — the widget surface must not be usable to map the agent API); the
   * route gate proves the Copilot scope; the check below proves `reports_read`;
   * and `withTenant` binds every figure to the caller's own license, so another
   * license's numbers have no path into the answer.
   *
   * No `chatId`, unlike the assists above: a BI question is about the workspace,
   * not about the conversation the agent happens to have open. It takes no
   * `from`/`to` either — the window comes from the question ("last week") and is
   * named back in the answer, so a caller always knows what they were told.
   */
  app.post(
    '/copilot/bi',
    { config: { scopes: BI_COPILOT, aiInference: true } },
    async (request, reply) => {
      const body = parse(biBody, request.body);

      // The second half of the scope union — see BI_COPILOT/BI_REPORTS above.
      const principal = request.requirePrincipal();
      if (!hasAnyScope(scopesOf(principal), BI_REPORTS)) {
        throw ApiError.authorization(
          `This token is missing the required scope (one of: ${BI_REPORTS.join(', ')}).`,
        );
      }

      const tenant = request.tenant();
      // Read once, here: the window a relative phrase names is a function of the
      // request's instant, and resolving it twice inside one request could land a
      // question asked at 23:59:59.999 on two different days.
      const now = new Date();

      const answer = await request.withTenant((tx) =>
        copilot.answerBi(tx, tenant, body.question, now),
      );
      return reply.send(answer);
    },
  );
}
