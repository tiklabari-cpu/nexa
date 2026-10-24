/**
 * The AI usage surface (tm 283.3 · SiyahTuş analysis AI-16, AI-16-S2/S3).
 *
 * A workspace's AI runs against a daily token allowance (tm 257.8, per
 * workspace since tm 283.2) that, until this, nobody in the workspace could
 * see: the first sign of it was the AI going quiet. Two routes:
 *
 *   - `GET /ai/usage` — today's use of each meter against its cap, the last 30
 *     UTC days, which feature spent what, an estimated cost when the operator
 *     configured prices, today's alerts and who receives them. Owner and admin
 *     (`reports_read` + `minimumRole: admin`, RL-02 will name the capability);
 *     an agent is refused. Numbers only — no conversation, no prompt, no text.
 *   - `PUT /ai/usage/alert-recipients` — the owner chooses who, besides
 *     themselves, receives the 80%/100% alerts (`ai-usage-alerts.ts`). Owner
 *     only: AI-16 gives the choice to the founder. Recipients must be owners,
 *     vice-owners or admins of the workspace — the people the screen the
 *     alert links to is open to.
 *
 * **The cap is not editable here, by anyone in the workspace.** It is the
 * platform's (`licenses.ai_daily_*_tokens_cap`, refused to this API's role by
 * a trigger); the screen shows it and the alerts warn about it, and raising it
 * is a conversation with the SiyahTuş team (AI-16-S2).
 *
 * **UTC days.** The cap renews at 00:00 UTC, so the series is keyed by UTC day
 * and `resets_at` names that midnight; the workspace's own time zone would
 * draw bars that do not add up to the allowance they are measured against.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import type { AiDailyBudget } from '../services/ai/ai-daily-budget.js';
import { AI_USAGE_ALERT_ROLES, isoDay } from '../services/ai/ai-usage-alerts.js';
import { customerAiQuotaToday } from '../services/ai/customer-ai-quota.js';
import { aiPrices, buildUsageReport, usageWindowDays } from '../services/ai/ai-usage-report.js';

export interface AiUsageRoutesOptions {
  env: Pick<
    Env,
    | 'AI_PRICE_LLM_INPUT_USD_PER_MTOK'
    | 'AI_PRICE_LLM_OUTPUT_USD_PER_MTOK'
    | 'AI_PRICE_EMBEDDING_USD_PER_MTOK'
  >;
  /** The server's one budget: the caps it checks calls against are the ones shown. */
  budget: Pick<AiDailyBudget, 'capsFor'>;
  /** The clock "today" is read from. */
  now?: () => Date;
}

/** Recipients a workspace may name — far more than an owner and their admins need. */
const MAX_RECIPIENTS = 20;

const recipientsBody = z.object({
  account_ids: z
    .array(z.string().uuid())
    .max(MAX_RECIPIENTS)
    .refine((ids) => new Set(ids).size === ids.length, 'must not repeat an account'),
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

export default async function aiUsageRoutes(
  app: FastifyInstance,
  options: AiUsageRoutesOptions,
): Promise<void> {
  const now = options.now ?? (() => new Date());
  const prices = aiPrices(options.env);

  app.get(
    '/ai/usage',
    { config: { scopes: ['reports_read'], minimumRole: 'admin' } },
    async (request, reply) => {
      const tenant = request.tenant();
      const at = now();
      const days = usageWindowDays(at);
      const first = days[0]!;
      const today = days[days.length - 1]!;
      // The ledger's index is (license_id, at DESC); a call reserved just before
      // midnight settles just after it, so `at` is bounded a day early and the
      // reservation's `day` decides.
      const since = new Date(`${isoDay(first)}T00:00:00Z`);
      since.setUTCDate(since.getUTCDate() - 1);

      const caps = await options.budget.capsFor(tenant);
      const rows = await request.withTenant(async (tx) => {
        const [counters, ledger, alerts, recipients, perMember] = await Promise.all([
          tx.aiDailyUsage.findMany({
            where: { licenseId: tenant.licenseId, day: { gte: first } },
            select: { day: true, meter: true, used: true, reserved: true },
          }),
          tx.aiUsageEvent.groupBy({
            by: ['day', 'surface', 'meter'],
            where: { licenseId: tenant.licenseId, day: { gte: first }, at: { gte: since } },
            _sum: { inputTokens: true, outputTokens: true },
          }),
          tx.aiUsageAlert.findMany({
            where: { licenseId: tenant.licenseId, day: today },
            orderBy: { createdAt: 'asc' },
            select: { meter: true, threshold: true, used: true, cap: true, createdAt: true },
          }),
          tx.aiUsageAlertRecipient.findMany({
            where: { licenseId: tenant.licenseId },
            orderBy: { createdAt: 'asc' },
            select: { accountId: true },
          }),
          customerAiQuotaToday(tx, { licenseId: tenant.licenseId, at }),
        ]);
        return { counters, ledger, alerts, recipients, perMember };
      });

      const report = buildUsageReport({
        now: at,
        caps: caps.workspace,
        counters: rows.counters.map((row) => ({
          day: row.day,
          meter: row.meter,
          used: Number(row.used),
          reserved: Number(row.reserved),
        })),
        ledger: rows.ledger.map((row) => ({
          day: row.day,
          surface: row.surface,
          meter: row.meter,
          input: Number(row._sum.inputTokens ?? 0n),
          output: Number(row._sum.outputTokens ?? 0n),
        })),
        prices,
      });

      reply.header('cache-control', 'no-store');
      return reply.send({
        ...report,
        time_zone: 'UTC',
        alerts: rows.alerts.map((alert) => ({
          meter: alert.meter,
          threshold: alert.threshold,
          used: Number(alert.used),
          cap: Number(alert.cap),
          created_at: alert.createdAt.toISOString(),
        })),
        alert_recipients: rows.recipients.map((row) => row.accountId),
        // The per-member allowance beside the workspace's token cap (tm 339.3 ·
        // GV-01): counts only, on the workspace's conversation day — not the UTC
        // day the token meters use.
        per_member: {
          day: rows.perMember.day,
          cap: rows.perMember.cap,
          members_with_ai: rows.perMember.membersWithAi,
          members_at_cap: rows.perMember.membersAtCap,
        },
      });
    },
  );

  app.put(
    '/ai/usage/alert-recipients',
    { config: { scopes: ['reports_manage'], exactRole: 'owner' } },
    async (request, reply) => {
      const body = parse(recipientsBody, request.body);
      const tenant = request.tenant();
      const ids = body.account_ids;

      const saved = await request.withTenant(async (tx) => {
        const eligible = await tx.agentMembership.findMany({
          where: {
            licenseId: tenant.licenseId,
            agentId: { in: ids },
            suspended: false,
            role: { in: [...AI_USAGE_ALERT_ROLES] },
          },
          select: { agentId: true },
        });
        if (eligible.length !== ids.length) {
          throw ApiError.validation(
            'account_ids: every recipient must be an active owner, vice-owner or admin of this workspace.',
          );
        }
        const before = await tx.aiUsageAlertRecipient.findMany({
          where: { licenseId: tenant.licenseId },
          select: { accountId: true },
        });
        await tx.aiUsageAlertRecipient.deleteMany({ where: { licenseId: tenant.licenseId } });
        if (ids.length > 0) {
          await tx.aiUsageAlertRecipient.createMany({
            data: ids.map((accountId) => ({ licenseId: tenant.licenseId, accountId })),
          });
        }
        // Who will be told the AI is running out — ids only.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.ai_usage_alerts_updated',
          target: `license:${tenant.licenseId}`,
          metadata: {
            previous_account_ids: before.map((row) => row.accountId),
            account_ids: ids,
          },
        });
        return ids;
      });

      return reply.send({ alert_recipients: saved });
    },
  );
}
