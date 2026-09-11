/**
 * The rule bot's read side (FR-MOD-06.6): which bot answers this message, and
 * with what.
 *
 * Nothing here reaches `@nexa/ai-mock`, an embedding, the knowledge base or the
 * skill engine — that is the requirement, not a preference, and
 * `rule-bot-isolation.test.ts` asserts it against this module's import graph.
 *
 * ## How a bot is reached, and why priority is visible
 *
 * PRD:577's KK has two halves. The first is the rule matcher next door. The
 * second — "gruplara priority ile atanır" — is this file: a bot is reachable
 * from a conversation when it serves one of the teams that conversation belongs
 * to (`chat_access`, the same rows routing and the inbox read), and the teams
 * order the bots. Each assignment carries one of `GROUP_PRIORITIES`; a bot's
 * standing on a chat is its BEST tier across the teams it shares with that
 * chat, which is the same "fullest tier present" reading `routing-service.ts`
 * applies to agents. Ties fall back to the older bot, so the order is total and
 * a workspace sees the same answer twice.
 *
 * ## The cost is constant in the number of bots and rules
 *
 * Three queries, and a fourth only when some rule actually asks about business
 * hours: the chat's teams, the assignments for those teams, and the enabled
 * bots with their enabled rules. A bot-at-a-time or rule-at-a-time walk would
 * put a query count on the customer's own send path, which NFR-P2 rules out —
 * and this runs on EVERY inbound message, including the ones no rule matches.
 */
import {
  GROUP_PRIORITY_ORDER,
  type GroupPriority,
  type RuleBotActions,
  type RuleBotConditions,
} from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { elapsedMinutes, type BusinessWeek } from '../sla/business-hours.js';
import { readBusinessWeek } from '../sla/sla-service.js';
import { matchesRuleBot, type RuleBotContext } from './rule-bot-matching.js';

/** What the engine was asked about. */
export interface RuleBotRequest {
  chatId: string;
  /** The visitor's message, already masked exactly as it was stored. */
  message: string;
  /** The page they wrote from, when the widget sent one. */
  pageUrl: string | null;
}

/** The rule that won, named so the caller can log and test which one it was. */
export interface RuleBotMatch {
  botId: string;
  botName: string;
  ruleId: string;
  ruleName: string;
  actions: RuleBotActions;
}

interface CandidateRule {
  id: string;
  name: string;
  conditions: RuleBotConditions;
  actions: RuleBotActions;
}

interface Candidate {
  botId: string;
  botName: string;
  tier: number;
  createdAt: Date;
  rules: CandidateRule[];
}

/** An unknown priority sorts after every known tier rather than before them. */
const UNKNOWN_TIER = 99;

/**
 * The first enabled rule, of the first bot, that matches — or null.
 *
 * First match wins across the whole walk, unlike ticket rules, which accumulate.
 * A bot that applied three matching rules would send the visitor three messages
 * for one question, and "which of my rules answered?" would stop having an
 * answer.
 */
export async function selectRuleBotMatch(
  tx: TenantClient,
  tenant: TenantContext,
  input: RuleBotRequest,
  now: Date,
): Promise<RuleBotMatch | null> {
  const candidates = await readCandidates(tx, tenant, input.chatId);
  if (candidates.length === 0) return null;

  // Read the calendar only if some rule actually asks about it. Most workspaces
  // have no `office_hours` rule at all, and this is the customer's send path.
  const needsCalendar = candidates.some((bot) =>
    bot.rules.some((rule) => rule.conditions.office_hours != null),
  );
  const week = needsCalendar ? await readBusinessWeek(tx, tenant, now) : null;

  const ctx: RuleBotContext = {
    message: input.message,
    pageUrl: input.pageUrl,
    withinBusinessHours: needsCalendar ? isOpenAt(week, now) : null,
  };

  for (const bot of candidates) {
    for (const rule of bot.rules) {
      if (!matchesRuleBot(rule.conditions, ctx)) continue;
      return {
        botId: bot.botId,
        botName: bot.botName,
        ruleId: rule.id,
        ruleName: rule.name,
        actions: rule.actions,
      };
    }
  }
  return null;
}

/**
 * The enabled bots this chat can reach, in the order they should be tried.
 *
 * Every read rides the tenant-scoped client, so another workspace's bot is not
 * merely filtered out — it never arrives.
 */
async function readCandidates(
  tx: TenantClient,
  tenant: TenantContext,
  chatId: string,
): Promise<Candidate[]> {
  const access = await tx.chatAccess.findMany({ where: { chatId }, select: { groupId: true } });
  if (access.length === 0) return [];

  const assignments = await tx.botGroup.findMany({
    where: { licenseId: tenant.licenseId, groupId: { in: access.map((a) => a.groupId) } },
    select: { botId: true, priority: true },
  });
  if (assignments.length === 0) return [];

  // Best tier per bot: a bot serving two of this chat's teams is tried at its
  // strongest standing, not at whichever row came back first.
  const bestTier = new Map<string, number>();
  for (const assignment of assignments) {
    const tier = GROUP_PRIORITY_ORDER[assignment.priority as GroupPriority] ?? UNKNOWN_TIER;
    const current = bestTier.get(assignment.botId);
    if (current === undefined || tier < current) bestTier.set(assignment.botId, tier);
  }

  const bots = await tx.bot.findMany({
    where: { licenseId: tenant.licenseId, id: { in: [...bestTier.keys()] }, enabled: true },
    select: {
      id: true,
      name: true,
      createdAt: true,
      rules: {
        where: { enabled: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, conditions: true, actions: true },
      },
    },
  });

  return bots
    .map((bot) => ({
      botId: bot.id,
      botName: bot.name,
      tier: bestTier.get(bot.id) ?? UNKNOWN_TIER,
      createdAt: bot.createdAt,
      rules: bot.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        conditions: (rule.conditions ?? {}) as RuleBotConditions,
        actions: (rule.actions ?? {}) as RuleBotActions,
      })),
    }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.botId.localeCompare(b.botId),
    );
}

/**
 * Is the workspace open at this instant?
 *
 * Asked of the SLA module's own calendar rather than a second one, so "open"
 * means the same thing to a rule and to a first-response target (§C-A27): the
 * union of the agents' saved `work_schedules`. Expressed as "how many open
 * minutes are there in the minute containing `now`", which is the one question
 * `elapsedMinutes` already answers exactly — and it answers it the right way for
 * a workspace that saved no schedules at all, where `week` is null and the
 * result is "open", because an absent calendar is never turned into an invented
 * 09:00-18:00.
 */
function isOpenAt(week: BusinessWeek | null, now: Date): boolean {
  return elapsedMinutes(now, new Date(now.getTime() + 60_000), week) > 0;
}
