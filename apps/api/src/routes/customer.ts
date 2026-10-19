/**
 * Customer Chat API — the surface the widget talks to.
 *
 * Separate from the agent routes because the shapes genuinely differ: a
 * customer has one conversation and no concept of teams, assignment or notes.
 * Reusing the agent endpoints and filtering afterwards would mean every future
 * field added there is exposed to the widget until someone remembers to hide it.
 *
 * Every route here is `principals: ['customer']`. An agent token reaching them
 * would work, but the agent API is what agents should use, and keeping the two
 * disjoint means the widget surface can be reasoned about on its own.
 */
import { isMailLocale } from '../services/mail/templates/layout.js';
import { visitorMessageMail } from '../services/mail/templates/messages.js';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  isIdentityTrust,
  REFERRER_MAX_LENGTH,
  SALES_TRACKER_EXTERNAL_ORDER_ID_MAX_LENGTH,
  SALES_TRACKER_EXTERNAL_ORDER_ID_RE,
  SALES_TRACKER_MAX_AMOUNT_CENTS,
  SNEAK_PEEK_MAX_LENGTH,
  typingStateKey,
  WIDGET_UI_LOCALES,
  type Region,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { WorkspaceEventDispatcher } from '../services/webhooks/workspace-events.js';
import { maskForWrite } from '../lib/sensitive-mask.js';
import { isIpBanned } from '../lib/banned-ip.js';
import { evaluateSpam, isSpamFilterEnabled } from '../services/security/spam-filter.js';
import type { Env } from '../config/env.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { CustomerService } from '../services/customers/customer-service.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import { TicketService } from '../services/tickets/ticket-service.js';
import { deliverPendingCampaign } from '../services/campaigns/campaign-delivery.js';
import { markCampaignEngaged } from '../services/campaigns/campaign-engagement.js';
import { fireCampaignsAtVisitor } from '../services/campaigns/campaign-trigger.js';
import { createGoalConversionRecorder } from '../services/goals/goal-triggers.js';
import { AiResponder } from '../services/ai/ai-responder.js';
import type { AiJobRun } from '../services/ai/ai-job-worker.js';
import {
  AI_JOB_MAX_UNFINISHED_PER_CHAT,
  aiJobOutbox,
  type EnqueuedAiJob,
} from '../services/ai/ai-jobs.js';
import type { VisitorTurn } from '../services/chat/visitor-turn.js';
import { withTenant } from '../lib/tenant.js';
import type { KnowledgeService } from '../services/ai/knowledge-service.js';
import type { MeteredLlm } from '../services/ai/metered-llm.js';
import { ConversationEngine } from '../services/ai/conversation/conversation-engine.js';
import type { TenantRunner } from '../services/ai/conversation/turn.js';
import { RuleBotResponder } from '../services/bots/rule-bot-responder.js';
import { createObjectStore } from '../services/storage/object-store.js';
import { assertUploadedAttachment } from '../services/storage/attachment.js';
import { logUnsentMail } from '../services/mail/delivery.js';
import type { PushEventKind, PushProvider } from '../services/push/push-provider.js';
import {
  claimAssigneeEmailWindow,
  shouldEmailAssignee,
} from '../services/notifications/assignee-email.js';
import { bindChatLogContext } from '../plugins/log-context.js';
import { pushToAgentDevices } from '../services/notifications/push.js';
import { resolveAttribution } from '../services/sales/attribution.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { missingPrechatFields, readCustomerPrechat } from '../services/websites/prechat.js';

const startSchema = z
  .object({
    // Optional now that an attachment can stand alone (FR-MOD-11.4): a visitor
    // may send just a screenshot. The either/or is enforced by the refine below,
    // the same invariant the agent path applies in `chats.ts`.
    text: z.string().trim().max(10_000).optional(),
    /** A file the visitor uploaded through `/uploads`, validated before use. */
    attachment_url: z.string().max(2048).optional(),
    /** Page the visitor is on — feeds the routing rules. */
    url: z.string().max(2048).optional(),
    /**
     * Where the visitor came from, recorded once as the visit's `came_from`
     * (FR-MOD-13.2). Trimmed to origin + path before it is stored — see
     * `sanitizeReferrer`; the cap here only bounds the body.
     */
    referrer: z.string().max(REFERRER_MAX_LENGTH).optional(),
    /** Optional pre-chat form values. */
    name: z.string().trim().max(120).optional(),
    /** The visitor's username on the embedding site — unverified, kept as typed. */
    username: z.string().trim().max(120).optional(),
    email: z.string().email().max(320).optional(),
    /**
     * The language the widget is showing (WG-02), recorded on the contact when
     * this message opens a chat and used for the visitor's transcript e-mail.
     */
    locale: z.enum(WIDGET_UI_LOCALES as unknown as [string, ...string[]]).optional(),
    /**
     * Pre-chat form answers (FR-MOD-08.7.7): a map of contact custom-field id →
     * value, validated against each field's definition (type + required) and
     * written to the contact. A `null` clears a field.
     */
    custom_fields: z.record(z.string().max(5000).nullable()).optional(),
    idempotency_key: z.string().min(1).max(128).optional(),
  })
  // `.strict()` for the reason `campaigns.ts` gives for its conditions: a typo
  // in a key the visitor's context rides on (`referer`, `custom_field`) must be
  // a 400 rather than a message that silently arrives stripped of it.
  .strict()
  .refine((body) => Boolean(body.text?.trim()) || Boolean(body.attachment_url), {
    message: 'A message must have text or an attachment.',
  });

const rateSchema = z.object({
  value: z.enum(['good', 'bad']),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Post-chat form answers (FR-MOD-08.7.7): a map of contact custom-field id →
 * value, the same shape the pre-chat answers ride the first message in. The
 * placement is not in the body — this endpoint *is* the post-chat placement, so
 * a visitor cannot ask to write against a form they were never shown.
 */
const formResponseSchema = z
  .object({
    custom_fields: z.record(z.string().max(5000).nullable()),
  })
  .strict();

/**
 * The widget's offline "leave a message" form (FR-MOD-08.7.7 `ticket` +
 * `prospect`).
 *
 * Two maps rather than one because the two forms asked on that screen have two
 * different destinations — `ticket_fields` are about the request and land on the
 * ticket, `prospect_fields` are about the person and land on the contact — and
 * a single map would leave the server guessing which was meant. Sending an id
 * under the wrong heading is a 400, so a question about the person can never be
 * stored as an answer about the request.
 *
 * `email` is required here and optional on the chat path, and the difference is
 * the point: a chat is answered in the widget the visitor is looking at, but a
 * message left when nobody is available can only be answered somewhere else.
 *
 * `.strict()` for `startSchema`'s reason: a typo in a key the visitor's context
 * rides on must be a 400, not a ticket that quietly arrives without it. And note
 * what is *not* here — no assignee, group, priority or status: a visitor says
 * what they need, never who should work on it.
 */
const leaveTicketSchema = z
  .object({
    // Capped at the ticket subject's own limit rather than a longer body that
    // would be silently truncated: a ticket stores a subject, so that is what
    // the widget asks for.
    subject: z.string().trim().min(1).max(200),
    name: z.string().trim().max(120).optional(),
    email: z.string().email().max(320),
    /** Answers to the `ticket` form — stored on the ticket this opens. */
    ticket_fields: z.record(z.string().max(5000).nullable()).optional(),
    /** Answers to the `prospect` form — stored on the contact. */
    prospect_fields: z.record(z.string().max(5000).nullable()).optional(),
  })
  .strict();

const typingSchema = z.object({
  is_typing: z.boolean(),
  // The in-progress text shown to the agent as a sneak-peek. Capped here as well
  // as at the fan-out, so an oversized body is rejected before any work.
  text: z.string().max(SNEAK_PEEK_MAX_LENGTH).optional(),
});

/**
 * One completed order, as the shop's confirmation page reports it (FR-MOD-13.5).
 *
 * Note what is *not* here: no `license_id`, no `chat_id`, no `customer_id`. The
 * party filling this in is a page in the visitor's browser, so every field that
 * decides whose revenue this is comes from the token instead (NFR-S5).
 *
 * Deliberately not `.strict()`, unlike `startSchema` above. The requirement is
 * that a forged `license_id` be *ignored* — a hostile page must get a plain,
 * uninteresting 201 written to its own workspace, not a 400 that tells it the
 * field is recognised and worth probing. Stripping unknown keys is safe here
 * only because all three real fields are required: a typo in one of them still
 * leaves a required field missing and fails as a 400.
 */
const trackSaleSchema = z.object({
  external_order_id: z
    .string()
    .trim()
    .min(1)
    .max(SALES_TRACKER_EXTERNAL_ORDER_ID_MAX_LENGTH)
    .regex(SALES_TRACKER_EXTERNAL_ORDER_ID_RE, 'must be a plain order reference'),
  // `z.number().int()` rejects `49.9` and `"4990"` alike: the shop sends minor
  // units, and a float here would be a units mistake worth failing loudly on
  // rather than rounding into the revenue figure.
  amount_cents: z.number().int().min(0).max(SALES_TRACKER_MAX_AMOUNT_CENTS),
  // Compared against the workspace's configured currency in the handler; the
  // shape check is here so a 30 KB string never reaches the comparison.
  currency: z.string().trim().length(3),
});

/**
 * How many of the visitor's conversations are considered for attribution.
 *
 * Attribution only ever credits one, and the newest chats are the candidates —
 * a visitor with more than this many conversations has plenty inside any sane
 * window. The cap is what stops a long-lived visitor's history from being
 * loaded in full on a path a page can call at will.
 */
const ATTRIBUTION_CANDIDATE_LIMIT = 20;

/** The tracked-sale fields the widget is answered with. */
const SALE_FIELDS = {
  id: true,
  externalOrderId: true,
  amountCents: true,
  currency: true,
  attributed: true,
  chatId: true,
  createdAt: true,
} as const;

interface TrackedSaleRow {
  id: string;
  externalOrderId: string;
  amountCents: number;
  currency: string;
  attributed: boolean;
  chatId: string | null;
  createdAt: Date;
}

function serialiseSale(sale: TrackedSaleRow) {
  return {
    id: sale.id,
    external_order_id: sale.externalOrderId,
    amount_cents: sale.amountCents,
    currency: sale.currency,
    attributed: sale.attributed,
    chat_id: sale.chatId,
    created_at: sale.createdAt.toISOString(),
  };
}

/** Two reports of the same order racing: `UNIQUE(license_id, external_order_id)` decides. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

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

/**
 * Form answers with every sensitive value masked out of each one
 * (FR-MOD-08.9.5 · AI-26 · tm 300.2) — a card, a password, a one-time code, an
 * IBAN — before any of them reaches the database. Every widget form goes
 * through this — the pre-chat answers riding the first message, the post-chat
 * ones and both halves of the offline form — so a visitor typing a secret into
 * a free-text question is masked wherever they were asked it.
 */
function maskAnswers(
  values: Record<string, string | null> | undefined,
): Record<string, string | null> {
  if (!values) return {};
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, maskForWrite(value, 'customer').text]),
  );
}

/** What asked for the residency check on a visitor's message (the audit entry's `route`). */
const VISITOR_MESSAGE_JOB = 'ai_job:visitor_message';

export default async function customerRoutes(
  app: FastifyInstance,
  {
    env,
    push,
    automations,
    llm,
    knowledge,
  }: {
    env: Env;
    push: PushProvider;
    /**
     * Writes the AI Agent's knowledge answers (tm 255.5), every call counted
     * against the daily AI caps (tm 257.8).
     */
    llm: MeteredLlm;
    /**
     * Finds the passages those answers stand on — the server's one instance,
     * over its configured embedding provider (tm 255.7). Until then the engine
     * here built its own over the lexical stub, whatever the deployment said.
     */
    knowledge: KnowledgeService;
    /** Fans a committed lifecycle event out to Zapier/Make subscriptions (FR-MOD-09.4). */
    automations?: WorkspaceEventDispatcher;
  },
): Promise<void> {
  const publisher = new RealtimePublisher(app.redis, app.log);
  // A chat the visitor opened from the widget is as much a workspace event as
  // one an agent started, so the same emitter is wired on this side too — a zap
  // that only fired for agent-opened chats would miss almost every one.
  const chats = new ChatService(
    app.db,
    app.redis,
    publisher,
    undefined,
    undefined,
    undefined,
    undefined,
    automations,
  );
  const customerDirectory = new CustomerService();
  const customFields = new CustomFieldService();
  // Only ever entered through `createFromWidget` from here: the visitor has no
  // principal, so none of the scope-guarded methods on it are reachable.
  const tickets = new TicketService();
  // Every moment a visitor can convert on this route — a page view, an e-mail
  // that makes them a lead, a reported sale — goes through the one recorder
  // (FR-MOD-13.3). The chat core holds its own for the close path.
  const goals = createGoalConversionRecorder(app.db, { logger: app.log });
  const ai = new AiResponder(
    chats,
    publisher,
    new ConversationEngine({
      llm,
      knowledge,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxPromptChars: env.LLM_MAX_PROMPT_CHARS,
    }),
    {
      // Messages written this close together get one answer (tm 292.4 · AI-01
      // §5); an agent's own `batch_window_seconds` replaces this (tm 292.5).
      batchWindowMs: env.AI_BATCH_WINDOW_MS,
      historyBudget: {
        maxMessages: env.AI_HISTORY_MAX_MESSAGES,
        maxChars: env.AI_HISTORY_MAX_CHARS,
      },
    },
  );
  const ruleBots = new RuleBotResponder(chats, publisher);
  const store = createObjectStore(env.STORAGE_PROVIDER, env.storage);

  /**
   * Everything a visitor's committed message sets off besides its own
   * delivery: an answer — the rule bot, then the AI Agent — and then the
   * assignee's notice. The order is the one this handler always ran them in
   * (the notice reads the assignee a bot's transfer may just have changed);
   * what moved is *when* and *where*. Since tm 256.10 after the response, so
   * the visitor's send no longer waits out the model; since tm 289.5 as a
   * durable job (ADR-11a · GV-02): the route writes the job with the message
   * (`aiJobOutbox`, in the message's own transaction) and the AI job worker
   * runs this — in whichever API process claims it, one job at a time per
   * chat, in the order the messages came. A restart no longer loses the
   * answer, and the job's fence (`run.replyOutbox`) lets a message be answered
   * once, whichever of the two responders answers it. The answer reaches the
   * widget the way an agent's reply does — the socket, or the next poll.
   *
   * Everything here comes from the job, not from the request that wrote it:
   * the text from the message's own event (masked at the source), the page and
   * whether the message opened its connection from the job's row. An
   * attachment with no text gives the bot and the skill nothing to match, so it
   * is only announced. A replay writes no job, so it is not answered or
   * announced twice.
   */
  async function answerVisitorMessage(run: AiJobRun): Promise<void> {
    const { job } = run;
    const tenant = job.context;
    const inTenant: TenantRunner = (fn) => withTenant(app.db, tenant, fn);

    const message = await inTenant(async (tx) => {
      const event = await tx.event.findFirst({
        where: {
          id: job.triggerEventId,
          threadId: job.threadId,
          // The event is written just before its job, in the same transaction:
          // the bound keeps the lookup to a partition or two of `events`.
          createdAt: {
            gte: new Date(job.createdAt.getTime() - 86_400_000),
            lte: new Date(job.createdAt.getTime() + 1_000),
          },
        },
        select: { text: true },
      });
      const row = await tx.aiJob.findUnique({
        where: { id: job.id },
        select: { pageUrl: true, openedConnection: true, identityTrust: true },
      });
      return event && row ? { text: event.text, ...row } : null;
    });
    // Gone with its connection — the worker has nothing to answer either.
    if (!message) return;

    const turn: VisitorTurn = {
      tenant,
      chatId: job.chatId,
      threadId: job.threadId,
      customerId: run.customerId,
      triggerEventId: job.triggerEventId,
      requestId: job.requestId,
      // The job's lines name its tenant, chat, connection and request; these
      // add the visitor, as the request that wrote the message named them (ID-08).
      log: run.log.child({
        actor_type: 'customer',
        actor_id: run.customerId,
        customer_id: run.customerId,
      }),
      withTenant: inTenant,
      requireAiInference: async () => {
        const organization = await inTenant((tx) =>
          tx.organization.findUnique({
            where: { id: tenant.organizationId },
            select: { region: true },
          }),
        );
        await app.requireAiInference({
          tenant,
          // `organizations_region_check` holds the column to `REGIONS`.
          region: (organization?.region ?? 'eu') as Region,
          // The visitor whose message it is, as their own request recorded it.
          auditContext: () => ({
            chainSecret: env.AUDIT_CHAIN_SECRET,
            licenseId: tenant.licenseId,
            actorId: run.customerId,
            actorType: 'customer',
            requestId: job.requestId,
            ip: null,
          }),
          route: VISITOR_MESSAGE_JOB,
        });
      },
      requireAiBudget: () => app.requireAiBudget(tenant),
      replyProperties: run.replyProperties,
      replyOutbox: run.replyOutbox,
      // `ai_jobs_identity_trust_check` holds the column to `IDENTITY_TRUSTS`;
      // a job that recorded none is unproven.
      identityTrust: isIdentityTrust(message.identityTrust) ? message.identityTrust : 'claimed',
    };

    if (message.text?.trim()) {
      await respondToCustomerMessage(turn, message.text, message.pageUrl);
    }
    await notifyAssignee(turn, message.openedConnection ? 'new_chat' : 'message');
  }

  /**
   * Answer an incoming customer message: the deterministic rule bot first
   * (FR-MOD-06.6), the AI Agent second.
   *
   * The order is the decision, and it is made once, here, rather than inside
   * either responder. A rule is a sentence the workspace wrote down and can
   * predict exactly; the AI is a guess. When both could answer, the predictable
   * one should — that is the whole reason somebody writes "if they ask about
   * opening hours, say this".
   *
   * The AI is skipped only when the bot actually TOOK THE CONVERSATION OVER, not
   * merely when a rule matched. A rule whose only action is a tag is an
   * annotation; treating it as an answer would mean "tag anything containing
   * 'refund' with billing" silently switched the AI off for every refund
   * question, which is the kind of defect nobody finds by reading the rule.
   */
  async function respondToCustomerMessage(
    turn: VisitorTurn,
    text: string,
    pageUrl: string | null,
  ): Promise<void> {
    const bot = await ruleBots.handle(turn, text, pageUrl);
    if (bot?.tookOver) return;
    await ai.handle(turn, text);
  }

  // Every visitor message is answered by the AI job worker from here on
  // (tm 289.5): this process's, or any other's that claims the job first.
  // `chats` writes the hand-over note a late job leaves for a person.
  app.aiJobs.start({ handler: answerVisitorMessage, notes: chats });

  /**
   * Tell the human assigned to a chat that their visitor wrote in
   * (FR-MOD-13.8), on both of the channels that reach somebody who is not
   * looking at the inbox: e-mail and their registered handsets.
   *
   * Best-effort on purpose: the message is already persisted and delivered over
   * realtime, so a mail or provider failure must not fail the visitor's send.
   * Only fires when there is a human assignee — a queued or AI-only chat has
   * nobody to notify, and notifying on every message to an unassigned chat
   * would be noise. The e-mail is further held to one per chat and assignee per
   * `ASSIGNEE_EMAIL_COOLDOWN_MS`, and sent in the background (tm 256.4). The
   * whole notice runs after the visitor's response, in the message's AI job
   * (`answerVisitorMessage`, tm 256.10 · tm 289.5).
   *
   * The two channels are gated separately and neither can suppress the other:
   * an agent who reads e-mail on a laptop and one who only carries a phone have
   * made different choices, and FR-MOD-13.8's "consistent across channels" is
   * about the *preferences* being one set, not about the deliveries being one
   * decision.
   */
  async function notifyAssignee(turn: VisitorTurn, kind: PushEventKind): Promise<void> {
    const { tenant, chatId, log } = turn;
    try {
      const licenseId = tenant.licenseId;
      const channel = await turn.withTenant(async (tx) => {
        const thread = await tx.thread.findFirst({
          where: { chatId, active: true },
          orderBy: { createdAt: 'desc' },
          select: { assigneeId: true },
        });
        if (!thread?.assigneeId) return null;

        // The account carries the address; the membership carries the per-user,
        // per-license opt-in — read together so the decision has both.
        const [account, membership, organization] = await Promise.all([
          tx.account.findUnique({
            where: { id: thread.assigneeId },
            select: { email: true, name: true },
          }),
          tx.agentMembership.findUnique({
            where: { licenseId_agentId: { licenseId, agentId: thread.assigneeId } },
            select: { notifyEmail: true, locale: true },
          }),
          tx.organization.findUnique({
            where: { id: tenant.organizationId },
            select: { name: true },
          }),
        ]);

        return {
          assigneeId: thread.assigneeId,
          email: account?.email ?? null,
          name: account?.name ?? null,
          // The agent's panel language (tm 265), not the visitor's.
          locale: isMailLocale(membership?.locale) ? membership.locale : 'en',
          workspaceName: organization?.name ?? 'SiyahTuş',
          // No membership row would be an inconsistency, not an opt-out; default
          // on, matching the column default.
          emailEnabled: membership?.notifyEmail ?? true,
        };
      });

      // Push first, and outside the e-mail guard: an agent who turned e-mail off
      // still carries their phone. `pushToAgentDevices` never throws, reads the
      // preference and the device list under the tenant's RLS, and is silent
      // when there is nothing to reach (13.7-d).
      if (channel) {
        await pushToAgentDevices({ db: app.db, provider: push, log }, tenant, {
          accountId: channel.assigneeId,
          event: { kind, chatId },
        });
      }

      // Honours the opt-out and the no-assignee/no-address cases in one place
      // (FR-MOD-13.8); the guard narrows `email` to a string for the send.
      if (!shouldEmailAssignee(channel)) return;

      // One e-mail per chat and assignee per window (tm 256.4): the first
      // message of a burst says "go and look", the rest would only repeat it
      // against the mailbox's sending limit. After the opt-out on purpose — an
      // agent who has the channel off must not use up a window.
      const open = await claimAssigneeEmailWindow(
        app.redis,
        {
          licenseId,
          chatId,
          assigneeId: channel.assigneeId,
          cooldownMs: env.ASSIGNEE_EMAIL_COOLDOWN_MS,
        },
        (error) => log.warn({ err: error }, 'assignee e-mail window unavailable; mailing'),
      );
      if (!open) return;

      // Handed off, not awaited (tm 256.4): the visitor's message is committed
      // and on its way over realtime, so neither the carrier's latency (~33 s
      // against a hung server) nor its failure belongs in their answer.
      app.backgroundMail.send(
        {
          to: channel.email,
          licenseId,
          kind: 'notification',
          ...visitorMessageMail(
            { locale: channel.locale, appUrl: env.WEB_APP_URL },
            {
              agentName: channel.name,
              workspaceName: channel.workspaceName,
              inboxUrl: `${env.WEB_APP_URL}/app/inbox`,
              settingsUrl: `${env.WEB_APP_URL}/app/settings/notifications`,
            },
          ),
        },
        (outcome) => logUnsentMail(log, 'assignee_notification.mail', outcome),
      );
    } catch (error) {
      // The realtime push already reached the agent's open inbox; e-mail and
      // handset are the courtesy for when it is not open.
      log.warn({ err: error }, 'assignee notification failed');
    }
  }

  /**
   * The widget's whole conversation state in one call.
   *
   * One round-trip on load rather than three: on a slow connection the
   * difference is whether the panel opens with the conversation already in it.
   *
   * Also the delivery path for campaigns (FR-MOD-03.3.2): a still-owed
   * `campaign_sends` row is answered with its message and stamped delivered in
   * this handler's own transaction. That makes a GET non-idempotent, which is
   * worth naming rather than leaving for someone to discover. It is safe here
   * for a specific reason — the route needs a customer bearer token, so no
   * crawler, link preview or browser speculative fetch can reach it; only the
   * widget's own poll loop can. The alternative, a separate claim endpoint,
   * would double the widget's request rate to buy a guarantee
   * (`campaign-delivery.ts` explains why at-least-once is the wrong one here)
   * that this surface does not want.
   */
  app.get('/customer/chat', { config: { principals: ['customer'] } }, async (request, reply) => {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

    // One clock for the whole poll: the campaign window is judged and the
    // delivery stamped against the same instant.
    const now = new Date();

    const state = await request.withTenant(async (tx) => {
      const chat = await tx.chat.findFirst({
        where: { customerId: principal.customerId, active: true },
        include: {
          threads: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      const [agentsOnline, customer] = await Promise.all([
        tx.agentMembership.count({
          where: { routingStatus: 'accepting_chats', suspended: false },
        }),
        tx.customer.findUnique({
          where: { id: principal.customerId },
          // `bannedAt` is not for the widget — it feeds the campaign delivery
          // decision below, which gets it free by riding on this read.
          select: { name: true, email: true, bannedAt: true },
        }),
      ]);

      // Who the visitor is talking to (FR-MOD-11.3). A human assignee wins — it
      // is a real person on the other end — otherwise the active AI persona,
      // which is who answers first when one is configured.
      const assigneeId = chat?.threads[0]?.assigneeId ?? null;
      const responder = assigneeId
        ? await tx.account.findUnique({
            where: { id: assigneeId },
            select: { name: true, avatarUrl: true },
          })
        : // The customer-facing persona only — `kind: 'copilot'` is the agent's
          // assistant, not who the visitor is talking to. Oldest-first so the
          // choice is stable when more than one exists.
          await tx.aiAgent.findFirst({
            where: { active: true, kind: 'ai_agent' },
            orderBy: { createdAt: 'asc' },
            select: { name: true, avatarUrl: true },
          });

      // Inside this transaction on purpose: the read that finds the owed send
      // and the write that marks it delivered commit together or not at all.
      const campaign = await deliverPendingCampaign(
        tx,
        request.tenant(),
        {
          customerId: principal.customerId,
          hasOpenChat: chat !== null,
          bannedAt: customer?.bannedAt ?? null,
        },
        now,
      );

      return { chat, agentsOnline, customer, responder, campaign };
    });
    if (state.chat) {
      bindChatLogContext(request, {
        chatId: state.chat.id,
        threadId: state.chat.threads[0]?.id ?? null,
      });
    }

    const events = state.chat
      ? await chats.listEvents(request.tenant(), principal, state.chat.id, { limit: 100 })
      : { items: [] };

    // Whether an agent is mid-reply (FR-MOD-02.9). The widget polls and holds no
    // socket, so an agent's typing cannot be pushed to it — the RTM gateway
    // writes a short-lived flag on each keystroke and it is read back here.
    const agentTyping = state.chat
      ? (await app.redis.get(typingStateKey(request.tenant().licenseId, state.chat.id))) !== null
      : false;

    return reply.send({
      // The widget shows "we're away" rather than pretending someone will
      // answer immediately.
      online: state.agentsOnline > 0,
      agent_typing: agentTyping,
      customer: {
        id: principal.customerId,
        name: state.customer?.name ?? null,
        email: state.customer?.email ?? null,
      },
      chat: state.chat
        ? {
            id: state.chat.id,
            thread_id: state.chat.threads[0]?.id ?? null,
            queue_position: state.chat.threads[0]?.queuePosition ?? null,
          }
        : null,
      // The name and face the widget shows in its header, so the visitor knows
      // whether they are talking to a person or the AI persona (FR-MOD-11.3).
      agent: state.responder
        ? { name: state.responder.name, avatar_url: state.responder.avatarUrl }
        : null,
      // The proactive message this poll is carrying, if one was owed
      // (FR-MOD-03.3.2). Null on every other poll, which is nearly all of them.
      // The campaign's internal name is deliberately not here: the owner named
      // it for their own list ("Q4 winback"), not for the visitor to read.
      campaign: state.campaign,
      events: events.items,
    });
  });

  /**
   * Send a message, opening a conversation if there is not one already.
   *
   * A single endpoint because from the widget's side there is no difference: a
   * visitor types and presses enter. Making the client decide between "start"
   * and "send" invites a race where two first messages both try to start.
   *
   * "A conversation" is a connection inside the member's chat for the day
   * (ID-02): the day's first message opens the chat, a message after the
   * previous connection ended opens a further one under the same chat, and
   * the next day starts a new chat (`ChatService.openOrContinueConnection`).
   */
  app.post(
    '/customer/chat/events',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(startSchema, request.body);
      const tenant = request.tenant();

      // An IP ban (FR-MOD-08.9.2) refuses the conversation itself, not just the
      // token: a token minted before the ban would otherwise still let the
      // address open or continue a chat. Enforced here — the one visitor-facing
      // write path — so "a banned visitor cannot start a chat" holds even for a
      // session that was already live. The identity ban (`Customer.bannedAt`) is
      // enforced deeper in `chat-service`; this is the address-based half.
      if (await request.withTenant((tx) => isIpBanned(tx, request.ip))) {
        throw new ApiError('customer_banned', 'This customer is banned.');
      }

      // Mask every sensitive value the moment the message arrives
      // (FR-MOD-08.9.5 · AI-26 · K12, tm 300.2) — a card, a password, an SMS
      // code, an IBAN, a seed phrase — then use the masked text for everything
      // downstream: the spam filter, the persisted event, the realtime push and
      // the AI, so a raw secret never reaches the database, a log or a model.
      // Mask once, at the very start. The types go with the event; the masked
      // text no longer shows them, and they are what the player is warned about.
      const masked = maskForWrite(body.text, 'customer');
      const maskedText = masked.text;

      // An attachment must be a file this workspace uploaded through `/uploads`
      // (FR-MOD-08.9.4) — the same check the agent path runs, before it can be
      // stored on an event.
      if (body.attachment_url) {
        await assertUploadedAttachment(store, tenant.licenseId, body.attachment_url);
      }

      // Whether this message opens a connection rather than continuing the open
      // one (ID-02): no open conversation, or yesterday's gone silent and about
      // to be closed under the visitor. Asked here — before any pre-chat write —
      // because the screens below apply only to a message that OPENS one, and a
      // refused opening must leave no trace.
      const opens = await chats.opensConnection(tenant, principal.customerId);

      // Spam filter (FR-MOD-08.9.3): screen the message that would open a chat.
      // A spam conversation floods the queue; screening only chat-start — not
      // every message in an established thread — keeps the false-positive cost
      // off a legitimate visitor mid-conversation (who may, say, paste several
      // links). Gated by the per-workspace spamFilterEnabled (schema default on)
      // and routed through the same deterministic engine the email channel uses.
      // A member back the same day is screened too: their message opens a new
      // connection the queue has to take, exactly as a first one does.
      if (opens && maskedText) {
        const spamFilterOn = await request.withTenant((tx) => isSpamFilterEnabled(tx));
        if (evaluateSpam({ filterEnabled: spamFilterOn, text: maskedText }).spam) {
          // An enveloped refusal, like the co-located banned-IP check: a
          // synchronous widget request has nothing to return once the chat is
          // refused, and a silent 2xx would leave a false-positive visitor
          // staring at a message no agent ever answers. The message is generic
          // on purpose — it names no rule, so the filter cannot be probed — and
          // nothing (no chat, no customer field write) is persisted.
          throw new ApiError('message_rejected', 'This message could not be sent.');
        }
      }

      // The brand's saved pre-chat form (WG-01), enforced on the message that
      // would open a conversation — the widget checks it too, but a scripted
      // request skips the widget. Refused before any write, like the spam
      // filter above, so a 400 leaves no trace. A detail already on the
      // contact counts: a returning visitor is not asked twice. The brand is
      // the one signed into the token at mint, i.e. the form the widget was
      // handed; an unsaved form is not enforced at all.
      if (opens) {
        const missing = await request.withTenant(async (tx) => {
          const prechat = await readCustomerPrechat(tx, principal.brandId);
          if (!prechat.configured || !prechat.config.enabled) return [];
          const stored = await tx.customer.findFirst({
            where: { id: principal.customerId },
            select: { name: true, username: true, email: true },
          });
          return missingPrechatFields(prechat, body, stored);
        });
        if (missing.length > 0) {
          throw ApiError.validation(`${missing.join(', ')}: required by the pre-chat form.`, {
            fields: missing.map((field) => ({ field, message: 'Required.' })),
          });
        }
      }

      // Pre-chat details, if the visitor gave them.
      if (body.name || body.username || body.email) {
        // Whether this write is what *made* them a lead, read in the same
        // transaction that does it. A lead goal (FR-MOD-13.3) fires on the
        // transition, not on the state: `isLead` stays true for ever after, and
        // re-evaluating on every subsequent message that carries the same
        // pre-chat details would spend the visitor's write budget re-deciding a
        // question already answered — the same "only when something genuinely
        // new happened" rule `evaluate` applies to `campaign_sends.converted`.
        const becameLead = await request.withTenant(async (tx) => {
          const before = await tx.customer.findFirst({
            where: { id: principal.customerId },
            select: { isLead: true },
          });
          await tx.customer.update({
            where: { id: principal.customerId },
            data: {
              ...(body.name ? { name: body.name } : {}),
              ...(body.username ? { username: body.username } : {}),
              ...(body.email ? { email: body.email, isLead: true } : {}),
              lastActivityAt: new Date(),
            },
          });
          return Boolean(body.email) && before?.isLead === false;
        });

        // After the transaction commits: `evaluate` reads `is_lead` back, so it
        // has to see the write that set it.
        if (becameLead) await goals.record(tenant, principal.customerId);
      }

      // The widget's language (WG-02), kept on the contact when this message
      // opens a conversation — the visitor's transcript e-mail is written in it.
      // After every refusal above, so a refused chat-start leaves no trace; not
      // on later messages, which would spend a write on a value that is already
      // there. A later chat from a different widget language updates it.
      if (opens && body.locale) {
        await request.withTenant((tx) =>
          tx.customer.update({
            where: { id: principal.customerId },
            data: { locale: body.locale },
          }),
        );
      }

      // Pre-chat form answers (FR-MOD-08.7.7): validated against their contact
      // custom-field definitions and written to the contact, one transaction so
      // it is all-or-nothing. An ill-typed value or a blank required field throws
      // a 400 here — before any chat is opened, so a bad form never leaves a
      // half-started conversation behind.
      if (body.custom_fields && Object.keys(body.custom_fields).length > 0) {
        // Pre-chat answers are visitor free text too — mask each value at the
        // source (FR-MOD-08.9.5) before it is written to the contact.
        const maskedFields = maskAnswers(body.custom_fields);
        await request.withTenant((tx) =>
          customFields.setValues(tx, tenant, 'contact', principal.customerId, maskedFields),
        );
      }

      // The page the visitor wrote from, and — when this is the first page of a
      // new visit — where they came from before it. Recorded on a best-effort
      // basis: both feed the panels an agent reads for context, and losing that
      // context is not worth failing the message the visitor is trying to send.
      //
      // Deliberately *not* a traffic-board publish site (FR-MOD-03.1.1), even
      // though a visit is one of the board's three sources. Every path through
      // this handler ends in `chats.openOrContinueConnection` below, which
      // announces the visitor itself; a second signal here would say the
      // same thing about the same person one step earlier, and — because the
      // request always leaves them in a conversation — the buckets a visit can
      // produce (`browsing`, `invited`) are ones this visitor is now in no
      // position to be in. The visit still reaches the board: on the day the
      // conversation closes, which is its own publish site.
      if (body.url) {
        try {
          await request.withTenant(async (tx) => {
            const pageUrls = await customerDirectory.recordPageView(tx, tenant, {
              customerId: principal.customerId,
              url: body.url!,
              referrer: body.referrer,
              userAgent: request.headers['user-agent'],
              ip: request.ip,
            });

            // Does this visitor now match a campaign that is already running
            // (FR-MOD-03.3.2, tm 176.5)? The owner's own save only ever fired at
            // the people who were on the site at that moment, so without this a
            // campaign never reaches anybody who arrives afterwards — the
            // ordinary case for a campaign left running.
            //
            // In the page view's own transaction on purpose: "seen on this page"
            // and "fired at for it" are one fact, and the read costs ~0.07 ms —
            // 0.02% of NFR-P2's write budget, measured rather than assumed
            // (`campaign-trigger.ts` shows the numbers and why no cache).
            return fireCampaignsAtVisitor(
              tx,
              tenant,
              { customerId: principal.customerId, pageUrls },
              new Date(),
            );
          });

          // Did that page take the visitor to a goal (FR-MOD-13.3)? Evaluated
          // over the whole visit rather than this one page, matching how the
          // campaign engine reads a visitor: someone who passed /thank-you and
          // then opened the widget on /support has still converted.
          //
          // A second transaction on purpose. Both are best-effort, but rolling
          // a failed goal evaluation back over the page view would lose the
          // browsing context that 13.2 records — and the achievement is written
          // with its own campaign-send update inside `evaluate`, which is the
          // pair that must be all-or-nothing.
          await goals.record(tenant, principal.customerId);
        } catch (error) {
          request.log.warn(
            { err: error },
            'could not record page view, fire campaigns or evaluate goals',
          );
        }
      }

      // One call decides and writes (ID-02): into the open connection, or into a
      // connection it opens under the member's chat for the day — the day's
      // first one, or a further one when they are back the same day. Routing
      // decides who takes an opened one; the customer never self-assigns.
      //
      // The answer this message is owed is written with it (tm 289.5 ·
      // ADR-11a): one AI job, in the message's own transaction — committed
      // together or not at all. `expired` at the door when the chat is
      // already too far behind.
      const enqueued: { job: EnqueuedAiJob | null } = { job: null };
      const result = await chats.openOrContinueConnection(tenant, principal, {
        customerId: principal.customerId,
        event: {
          type: 'message',
          ...(maskedText !== undefined ? { text: maskedText } : {}),
          ...(masked.types.length > 0 ? { sensitiveTypes: masked.types } : {}),
          ...(body.attachment_url ? { attachmentUrl: body.attachment_url } : {}),
          recipients: 'all',
          ...(body.idempotency_key ? { idempotencyKey: body.idempotency_key } : {}),
        },
        ...(body.url ? { routing: { url: body.url } } : {}),
        // The job below asks the AI to answer — when there is text to answer
        // (`answerVisitorMessage`); only then may an opening be AI-first (tm 293.2).
        aiAnswers: Boolean(maskedText?.trim()),
        audit: request.auditContext(),
        outbox: aiJobOutbox({
          requestId: request.id,
          pageUrl: body.url ?? null,
          // Who wrote it, as their token says (tm 294 · K4): what the AI may
          // recall of their day depends on it.
          identityTrust: principal.identity ?? null,
          onEnqueued: (job) => {
            enqueued.job = job;
          },
        }),
      });
      const chatId = result.chat.id;
      // From here every line names the day's chat and the connection this
      // message landed in (ID-08).
      bindChatLogContext(request, { chatId, threadId: result.event.thread_id });

      // A replay is the same message arriving twice and wrote no job; answering
      // or notifying again would do both twice for one question.
      if (result.replayed) return reply.status(200).send({ chat_id: chatId, event: result.event });

      if (enqueued.job?.state === 'expired') {
        // A chat this far behind is being written to faster than anything can
        // answer it. The message is committed and in the inbox; it is left for
        // a human, like any other failure on this path.
        request.log.warn(
          { pending: AI_JOB_MAX_UNFINISHED_PER_CHAT },
          'visitor follow-ups backed up; leaving this message for a human',
        );
      } else {
        // This process's worker looks now, rather than at its next poll.
        app.aiJobs.wake();
      }

      if (result.openedVia === null) {
        return reply.status(201).send({ chat_id: chatId, event: result.event });
      }

      // Campaign engagement (FR-MOD-03.3.2/.3, tm 176.4): a conversation the
      // visitor opened — the day's first or a return — is the "Chats" half of a
      // campaign card's numbers actually being earned; a delivery is only ever
      // owed while no conversation is open, which is exactly when one opens.
      // The connection is already committed in its own transaction, so this can
      // never be atomic with it anyway — its own transaction and best-effort,
      // same reasoning as the page-view/goal write above. Losing it should cost
      // a report number, not the message the visitor is trying to send.
      try {
        await request.withTenant((tx) =>
          markCampaignEngaged(tx, tenant, { customerId: principal.customerId, chatId }),
        );
      } catch (error) {
        request.log.warn({ err: error }, 'could not record campaign engagement');
      }

      // Routing may have assigned the connection to an agent — that is the
      // "assignment" notification (FR-MOD-13.8), sent by the job as `new_chat`
      // rather than `assignment` because of how it reads on a phone: nobody
      // handed this to the agent, a visitor walked in. The `event` this answers
      // with is the visitor's own message as written, never a reply that
      // committed first.
      return reply.status(201).send({
        chat_id: chatId,
        queue_position: result.chat.thread?.queue_position ?? null,
        event: result.event,
      });
    },
  );

  /**
   * Live typing preview from the visitor's side (FR-MOD-02.9 / 11.8).
   *
   * The widget calls this — debounced — while the visitor types, so the agent
   * sees "the visitor is typing" and a preview of the in-progress message. It is
   * ephemeral: nothing is written to the conversation, and the preview reaches
   * agents only, never echoed back to the visitor. Typing into a panel with no
   * open conversation is a no-op, not an error.
   */
  app.post(
    '/customer/chat/typing',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(typingSchema, request.body);

      const chat = await request.withTenant((tx) =>
        tx.chat.findFirst({
          where: { customerId: principal.customerId, active: true },
          select: { id: true },
        }),
      );

      if (chat) {
        bindChatLogContext(request, { chatId: chat.id });
        await chats.publishCustomerTyping(request.tenant(), principal, chat.id, {
          isTyping: body.is_typing,
          // The sneak-peek is pushed to the agent as the visitor types; mask it
          // there too (FR-MOD-08.9.5 · AI-26) so a secret is not exposed mid-type.
          ...(body.text !== undefined ? { text: maskForWrite(body.text, 'customer').text } : {}),
        });
      }

      return reply.status(204).send();
    },
  );

  /** Close the conversation from the customer's side. */
  app.post(
    '/customer/chat/close',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const chat = await request.withTenant((tx) =>
        tx.chat.findFirst({
          where: { customerId: principal.customerId, active: true },
          select: { id: true },
        }),
      );
      if (!chat) throw ApiError.chatInactive('There is no open conversation.');
      bindChatLogContext(request, { chatId: chat.id });

      await chats.deactivate(request.tenant(), principal, chat.id, request.auditContext());
      return reply.status(204).send();
    },
  );

  /**
   * Post-chat form answers (FR-MOD-08.7.7), written to the contact.
   *
   * Its own endpoint because there is nothing left to ride along with. The
   * pre-chat answers travel on the first message — the request that opens the
   * conversation — but by the time the post-chat form is answered the
   * conversation is over and the visitor sends nothing else; hanging the
   * answers off `/rating` instead would tie one to the other and lose the form
   * whenever somebody declines to vote.
   *
   * Deliberately not tied to a chat at all. The answers are the *contact's*,
   * like every other custom-field value, so they are as valid from a visitor
   * whose chat an agent archived seconds ago as from one who ended it
   * themselves — and demanding a chat here would drop the answer in exactly the
   * race the widget is most likely to hit.
   */
  app.post(
    '/customer/chat/form-response',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(formResponseSchema, request.body);
      const tenant = request.tenant();

      // Visitor free text on its way to the database — masked at the source
      // (FR-MOD-08.9.5), exactly as the pre-chat answers are above.
      const masked = maskAnswers(body.custom_fields);

      // `setFormValues`, not `setValues`: only a field the workspace actually
      // asks after the chat may be written from here. Type validation and the
      // required rule are the same ones the CRM and the pre-chat path apply.
      await request.withTenant((tx) =>
        customFields.setFormValues(tx, tenant, 'post_chat', principal.customerId, masked),
      );

      return reply.status(204).send();
    },
  );

  /**
   * Leave a message when nobody is available (FR-MOD-08.7.7) — the `ticket` and
   * `prospect` halves of the forms builder, and the only path by which a widget
   * answer reaches a *ticket* rather than a contact.
   *
   * Not a chat route, and deliberately not `/customer/chat/…`: this opens a
   * ticket precisely because there is no conversation to have. The visitor's
   * words become the ticket's subject, the `ticket` form's answers become custom
   * fields on that ticket, and the `prospect` form's answers become custom
   * fields on the contact who left it — one screen, two destinations, because
   * one set of questions is about the request and the other about the person.
   *
   * Three things make this safe to expose to a browser:
   *
   *   - It is **opt-in**. Until the workspace builds at least one `ticket` or
   *     `prospect` field, there is no form, and the endpoint refuses — a
   *     surface nobody enabled cannot be used. The widget applies the same rule
   *     from the other side (it shows no panel), so the server is not trusting
   *     it to.
   *   - It is screened exactly as the chat path is: the address ban
   *     (FR-MOD-08.9.2), card masking at the source (FR-MOD-08.9.5) and the
   *     same deterministic spam engine (FR-MOD-08.9.3) the widget and the
   *     e-mail channel share. Same visitor, same free text, same screening.
   *   - Everything is one transaction. The ticket is created *before* the
   *     answers are written, so an ill-typed answer takes the ticket down with
   *     it — a workspace never ends up with a message whose questions were
   *     silently dropped, and a visitor is never told their message was refused
   *     while a ticket sits in the queue.
   */
  app.post('/customer/ticket', { config: { principals: ['customer'] } }, async (request, reply) => {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

    const body = parse(leaveTicketSchema, request.body);
    const tenant = request.tenant();

    // The address-based ban, enforced on this write path for the reason the
    // chat path gives: a token minted before the ban would otherwise still let
    // the address reach the workspace.
    if (await request.withTenant((tx) => isIpBanned(tx, request.ip))) {
      throw new ApiError('customer_banned', 'This customer is banned.');
    }

    // Masked once, up front — the same value is what the spam classifier sees
    // and what the ticket stores, so no raw secret reaches either (AI-26).
    const subject = maskForWrite(body.subject, 'customer').text;

    const spamFilterOn = await request.withTenant((tx) => isSpamFilterEnabled(tx));
    if (evaluateSpam({ filterEnabled: spamFilterOn, text: subject }).spam) {
      // The chat path's wording and reasoning: generic, so the filter cannot be
      // probed, and nothing is persisted.
      throw new ApiError('message_rejected', 'This message could not be sent.');
    }

    // Visitor free text on its way to the database, masked at the source like
    // every other answer the widget sends.
    const ticketAnswers = maskAnswers(body.ticket_fields);
    const prospectAnswers = maskAnswers(body.prospect_fields);

    const result = await request.withTenant(async (tx) => {
      // Opt-in, checked inside the transaction that would do the writing: a
      // workspace that has built neither form has not turned this on.
      const ticketForm = await customFields.listTicketForm(tx, tenant);
      const prospectForm = await customFields.listProspectForm(tx, tenant);
      if (ticketForm.length === 0 && prospectForm.length === 0) {
        throw ApiError.validation('This workspace does not take messages left in the widget.');
      }

      // Whether this write is what *made* them a lead — read in the same
      // transaction that does it, the rule the pre-chat path already applies
      // (FR-MOD-13.3 fires on the transition, not on the state). Leaving a
      // message with an e-mail is what turns a prospect into a lead; the
      // placement itself is not a second identity for them.
      const before = await tx.customer.findFirst({
        where: { id: principal.customerId },
        select: { isLead: true },
      });
      await tx.customer.update({
        where: { id: principal.customerId },
        data: {
          ...(body.name ? { name: body.name } : {}),
          email: body.email,
          isLead: true,
          lastActivityAt: new Date(),
        },
      });

      const ticket = await tickets.createFromWidget(tx, tenant, {
        subject,
        customerId: principal.customerId,
      });

      // `setFormValues`, not `setValues`: only a field the workspace actually
      // asks on that form may be written from here — which is also what stops a
      // prospect question being answered onto the ticket, or the other way
      // round, since each map is judged against its own placement.
      if (Object.keys(prospectAnswers).length > 0) {
        await customFields.setFormValues(
          tx,
          tenant,
          'prospect',
          principal.customerId,
          prospectAnswers,
        );
      }
      if (Object.keys(ticketAnswers).length > 0) {
        await customFields.setFormValues(tx, tenant, 'ticket', ticket.id, ticketAnswers);
      }

      return { ticketId: ticket.id, becameLead: before?.isLead === false };
    });

    // After the transaction commits: `evaluate` reads `is_lead` back, so it has
    // to see the write that set it.
    if (result.becameLead) await goals.record(tenant, principal.customerId);

    return reply.status(201).send({ ticket_id: result.ticketId });
  });

  /** Customer satisfaction rating (FR-MOD-11). */
  app.post(
    '/customer/chat/rating',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(rateSchema, request.body);
      const tenant = request.tenant();

      const rating = await request.withTenant(async (tx) => {
        // The most recent conversation, open or not: ratings usually arrive
        // just after it closes.
        const chat = await tx.chat.findFirst({
          where: { customerId: principal.customerId },
          orderBy: { createdAt: 'desc' },
          include: { threads: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (!chat) throw ApiError.notFound('No conversation to rate.');

        return tx.rating.create({
          data: {
            chatId: chat.id,
            licenseId: tenant.licenseId,
            threadId: chat.threads[0]?.id ?? null,
            value: body.value,
            // A rating comment is visitor free text written to the database —
            // masked at the source like every other write path (FR-MOD-08.9.5 · AI-26).
            ...(body.comment ? { comment: maskForWrite(body.comment, 'customer').text } : {}),
          },
          select: { id: true, value: true, chatId: true },
        });
      });

      return reply.status(201).send({
        id: rating.id,
        value: rating.value,
        chat_id: rating.chatId,
      });
    },
  );

  /**
   * Report a completed order (FR-MOD-13.5) — the write the Ecommerce report is
   * built from.
   *
   * The only endpoint where a visitor's browser states a number the workspace
   * then reports as its own revenue, which sets the shape of everything below:
   * the body may say what was sold and for how much, and nothing about *whose*
   * sale it is. The workspace comes from the token and the conversation from the
   * attribution rule, so a `license_id` or `chat_id` in the body is stripped
   * before the handler ever sees it (NFR-S5) rather than trusted or refused.
   *
   * The customer rate limit already applies — it is keyed on the principal in
   * the shared plugin, so this route is inside the same 60/min bucket as the
   * rest of the widget surface — and the license gate refuses new sales in
   * read-only mode along with every other POST.
   */
  app.post(
    '/customer/chat/sale',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(trackSaleSchema, request.body);
      const tenant = request.tenant();
      const externalOrderId = body.external_order_id;
      const orderKey = {
        licenseId_externalOrderId: { licenseId: tenant.licenseId, externalOrderId },
      };

      // Tracking is off until a workspace turns it on, and no row means it has
      // never been configured — both are "we do not collect this", so neither may
      // write. Checked before anything is stored: a disabled workspace that
      // quietly accumulated rows would start reporting revenue for a period it
      // believed it was not tracking, the moment somebody flipped the switch.
      const config = await request.withTenant((tx) =>
        tx.salesTrackerSettings.findFirst({
          select: { enabled: true, currency: true, attributionWindowDays: true },
        }),
      );
      if (!config?.enabled) {
        throw new ApiError('not_allowed', 'Sales tracking is not enabled for this workspace.');
      }

      // One workspace, one currency (13.5-b). Amounts in a second currency cannot
      // be added to the first, and a tracker that accepted them would produce a
      // total that is not money in any currency — so a mismatch is refused at the
      // edge instead of being summed. The configured code is named in the message
      // because the caller is an integrator wiring up a snippet, and it is already
      // on every price the shop displays.
      const currency = body.currency.toUpperCase();
      if (currency !== config.currency.toUpperCase()) {
        throw ApiError.validation(`currency: this workspace tracks sales in ${config.currency}.`, {
          expected: config.currency,
        });
      }

      // Idempotency, first half. The same order arrives more than once in normal
      // operation — a merchant's at-least-once retry, a snippet firing twice, a
      // visitor refreshing the confirmation page — and a second row would be a
      // second sale in every report built on this table. Answered as a replay
      // (200, the existing record) rather than a conflict: the caller did nothing
      // wrong and has nothing to fix.
      const existing = await request.withTenant((tx) =>
        tx.trackedSale.findUnique({ where: orderKey, select: SALE_FIELDS }),
      );
      if (existing) return reply.status(200).send(serialiseSale(existing));

      const now = new Date();

      try {
        const sale = await request.withTenant(async (tx) => {
          // The visitor's recent conversations, newest first, each with the last
          // time they were in it. RLS scopes this to the license, and the
          // `customerId` filter to this visitor — so the chat a sale is credited
          // to can only ever be one the caller's own token could already read.
          const chats = await tx.chat.findMany({
            where: { customerId: principal.customerId },
            orderBy: { createdAt: 'desc' },
            take: ATTRIBUTION_CANDIDATE_LIMIT,
            select: {
              id: true,
              createdAt: true,
              threads: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
            },
          });

          const attribution = resolveAttribution({
            chats: chats.map((chat) => {
              const lastThreadAt = chat.threads[0]?.createdAt;
              return {
                chatId: chat.id,
                // The later of the two: a returning visitor reopens a thread on an
                // existing chat, so `createdAt` alone would date a conversation
                // held this morning to whenever it first started.
                at: lastThreadAt && lastThreadAt > chat.createdAt ? lastThreadAt : chat.createdAt,
              };
            }),
            now,
            windowDays: config.attributionWindowDays,
          });

          const created = await tx.trackedSale.create({
            data: {
              // From the tenant, never the body — this is the line the whole
              // shape of this route exists to protect.
              licenseId: tenant.licenseId,
              customerId: principal.customerId,
              chatId: attribution.chatId,
              externalOrderId,
              amountCents: body.amount_cents,
              currency,
              attributed: attribution.attributed,
            },
            select: SALE_FIELDS,
          });

          // Written inside the same transaction as the sale, so the trail and the
          // revenue cannot disagree, and only for a sale that is actually new —
          // an entry per retry would count orders differently from the report.
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'sale.tracked',
            target: `sale:${created.id}`,
            metadata: {
              amount_cents: created.amountCents,
              currency: created.currency,
              attributed: created.attributed,
            },
          });

          return created;
        });

        // A sale is a conversion (FR-MOD-13.3 — the "sale" funnel), evaluated
        // after the row commits so the matcher can see it. Only on the 201
        // path: the two replay branches around it report an order that was
        // already recorded, and whatever goal it reached was reached then —
        // the same reason the audit entry above is written only for a new sale.
        await goals.record(tenant, principal.customerId);

        return reply.status(201).send(serialiseSale(sale));
      } catch (error) {
        // Idempotency, second half: two reports of the same order in flight at
        // once. The check above passed for both, and the unique index let exactly
        // one insert win — the loser reads the winner's row and answers as a
        // replay, so concurrency produces one sale and one lot of revenue, not two.
        if (!isUniqueViolation(error)) throw error;

        const winner = await request.withTenant((tx) =>
          tx.trackedSale.findUnique({ where: orderKey, select: SALE_FIELDS }),
        );
        if (!winner) throw error;
        return reply.status(200).send(serialiseSale(winner));
      }
    },
  );
}
