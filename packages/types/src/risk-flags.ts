/**
 * Risk flags (tm 302.1 · SiyahTuş analysis AI-27): structured marks on a
 * conversation, and on the player behind it, that change what the AI and the
 * campaign engine may do — no bonus offered to someone asking to exclude
 * themselves (UKGC SR 3.4.3), no AI reply once a minor is suspected.
 *
 * One table, `risk_flags` (migration `20261019180000_risk_flags`), holds both
 * kinds a flag can be:
 *
 *   - `chat`   — the conversation's (the day container, panel "Thread ID"): it
 *                stops at the chat it was raised in;
 *   - `member` — the player's as well (AI-27-S1): `rg_signal`,
 *                `self_exclusion_request` and `underage_suspected` follow the
 *                player into every later conversation, with no end date, until
 *                someone with the authority clears them with a reason. A
 *                member flag still names the chat it was raised in, so it is
 *                that chat's too — one row, not two that could disagree.
 *
 * In F1 a player's identity is their own claim (ID-03: a username typed into
 * the pre-chat form), so a member flag is `declared` (AI-27-S3) and the panel
 * shows it as a warning, not a fact; `verified` waits for the operator's
 * platform (F2).
 *
 * A flag is never deleted: clearing it is a status change with a reason, the
 * row keeps who raised it, who cleared it and why (`risk_flag.cleared` in the
 * audit log, tm 302.2). Clearing `self_exclusion_request` changes nothing on
 * the operator's side — the self-exclusion itself is the operator's decision;
 * this is support's mark.
 *
 * {@link riskPolicy} is the one reading of a set of flags the API (every AI
 * turn, return-to-ai), the campaign engine (EN-01) and the widget's
 * configuration share.
 */
import type { AgentRole } from './domain.js';
import type { GuardrailHandoffTopic, GuardrailPriority } from './guardrails.js';
import { ROLE_RANK } from './role-scopes.js';

/**
 * The flag types (AI-27). The first four are responsible gaming's — what keeps
 * the AI from bonus talk, the campaign engine from the player, and a
 * conversation from going back to the AI (`AI_RETURN_BLOCKING_RISK_FLAGS`).
 *
 *   - `rg_signal`                  — signs of problem gambling (G2);
 *   - `self_exclusion_request`     — "close my account, I want to stop" (G1);
 *   - `underage_suspected`         — the player says or shows they are a minor (G5);
 *   - `self_harm`                  — self-harm or suicide (G3);
 *   - `complaint_formal`           — a formal complaint (G15);
 *   - `fraud_suspected`            — fraud or money laundering (G13);
 *   - `account_takeover_suspected` — someone else in the account (G13);
 *   - `multi_account`              — one player, several accounts;
 *   - `abusive`                    — abuse past its warnings (G19);
 *   - `account_security`           — a password or a code was shared (AI-26).
 */
export const RISK_FLAG_TYPES = [
  'rg_signal',
  'self_exclusion_request',
  'underage_suspected',
  'self_harm',
  'complaint_formal',
  'fraud_suspected',
  'account_takeover_suspected',
  'multi_account',
  'abusive',
  'account_security',
] as const;
export type RiskFlagType = (typeof RISK_FLAG_TYPES)[number];

/** How serious a flag is. `urgent` is what moves the hand-over to the front (AI-12). */
export const RISK_FLAG_SEVERITIES = ['info', 'high', 'urgent'] as const;
export type RiskFlagSeverity = (typeof RISK_FLAG_SEVERITIES)[number];

/** The conversation only, or the player too (AI-27-S1; see the module comment). */
export const RISK_FLAG_SCOPES = ['chat', 'member'] as const;
export type RiskFlagScope = (typeof RISK_FLAG_SCOPES)[number];

/**
 * Who raised it: a guardrail rule's hit (`rule_ref` names it), the
 * understanding call's risk signal, a person in the inbox, or QA review.
 */
export const RISK_FLAG_SOURCES = ['ai_rule', 'ai_classifier', 'agent', 'qa'] as const;
export type RiskFlagSource = (typeof RISK_FLAG_SOURCES)[number];

/** The player's own claim, or confirmed by the operator's platform (AI-27-S3; F1 is always `declared`). */
export const RISK_FLAG_BASES = ['declared', 'verified'] as const;
export type RiskFlagBasis = (typeof RISK_FLAG_BASES)[number];

export const RISK_FLAG_STATUSES = ['active', 'cleared'] as const;
export type RiskFlagStatus = (typeof RISK_FLAG_STATUSES)[number];

/**
 * Who may clear a flag (AI-27-S2): a Manager and up for the three member
 * types, a Team Lead and up for the rest.
 */
export const RISK_FLAG_CLEARERS = ['manager', 'team_lead'] as const;
export type RiskFlagClearer = (typeof RISK_FLAG_CLEARERS)[number];

/**
 * The lowest role of today's set each clearer is (K6: Manager = `admin`).
 * `team_lead` is `admin` too although the role exists (tm 324.1): until
 * RL-03 bounds a Team Lead to their teams, a Team Lead holds a Team Member's
 * powers (PLAN §D328, §D329). RL-03 moves it down and nothing else changes.
 */
export const RISK_FLAG_CLEAR_MIN_ROLE: Readonly<Record<RiskFlagClearer, AgentRole>> = Object.freeze(
  {
    manager: 'admin',
    team_lead: 'admin',
  },
);

/** A flag's note (`note`), the reason it was cleared (`clear_reason`), by CHECK. */
export const RISK_FLAG_NOTE_MAX = 1000;
export const RISK_FLAG_CLEAR_REASON_MAX = 500;
/** The events a flag cites as evidence (`evidence_event_ids`), at most. */
export const RISK_FLAG_EVIDENCE_MAX = 20;
/** The player's key on the operator's site (`member_key`, ID-03), at most. */
export const RISK_FLAG_MEMBER_KEY_MAX = 200;

/** What a type is unless whoever raises it says otherwise, and what it does. */
export interface RiskFlagTypeDefaults {
  readonly severity: RiskFlagSeverity;
  /** `member`: also the player's, in every later conversation (AI-27-S1). */
  readonly scope: RiskFlagScope;
  readonly clearer: RiskFlagClearer;
  /** Where its conversation's hand-over goes (AI-12's reason routes); null: the usual routing. */
  readonly topic: GuardrailHandoffTopic | null;
  /** The campaign engine and the widget show the player no campaign (EN-01). */
  readonly noPromotions: boolean;
  /** The AI offers no bonus, promotion or deposit, and bonus procedures go to a person. */
  readonly noBonusTalk: boolean;
  /** The AI writes nothing more in the flag's conversation, and it cannot be given back to the AI. */
  readonly mustHandoff: boolean;
}

const RG = {
  topic: 'responsible_gaming',
  noPromotions: true,
  noBonusTalk: true,
  mustHandoff: true,
} as const;

const PLAIN = { noPromotions: false, noBonusTalk: false, mustHandoff: false } as const;

/**
 * Per type. Severity: `urgent` for self-harm, a suspected minor and a self-
 * exclusion request (AI-27 §1), `high` for what someone must look at, `info`
 * for the rest. Topic: the guardrail rule's hand-over target (`guardrails.ts`).
 * Responsible gaming's four keep the player from promotions and the AI from
 * bonus talk, and hand over; fraud and multi-accounting do not suppress
 * campaigns by themselves — whether they should is EN-01's workspace setting.
 */
export const RISK_FLAG_DEFAULTS: Readonly<Record<RiskFlagType, RiskFlagTypeDefaults>> =
  Object.freeze({
    rg_signal: { severity: 'high', scope: 'member', clearer: 'manager', ...RG },
    self_exclusion_request: { severity: 'urgent', scope: 'member', clearer: 'manager', ...RG },
    underage_suspected: { severity: 'urgent', scope: 'member', clearer: 'manager', ...RG },
    self_harm: { severity: 'urgent', scope: 'chat', clearer: 'team_lead', ...RG },
    complaint_formal: {
      severity: 'high',
      scope: 'chat',
      clearer: 'team_lead',
      topic: 'complaints',
      ...PLAIN,
    },
    fraud_suspected: {
      severity: 'high',
      scope: 'chat',
      clearer: 'team_lead',
      topic: 'kyc_risk',
      ...PLAIN,
    },
    account_takeover_suspected: {
      severity: 'high',
      scope: 'chat',
      clearer: 'team_lead',
      topic: 'kyc_risk',
      ...PLAIN,
    },
    multi_account: {
      severity: 'info',
      scope: 'chat',
      clearer: 'team_lead',
      topic: 'kyc_risk',
      ...PLAIN,
    },
    abusive: { severity: 'info', scope: 'chat', clearer: 'team_lead', topic: null, ...PLAIN },
    account_security: {
      severity: 'info',
      scope: 'chat',
      clearer: 'team_lead',
      topic: null,
      ...PLAIN,
    },
  });

export function isRiskFlagType(value: unknown): value is RiskFlagType {
  return typeof value === 'string' && (RISK_FLAG_TYPES as readonly string[]).includes(value);
}

/** Whether `role` may clear a flag of `type` (AI-27-S2). A reason is required as well — the API's. */
export function canClearRiskFlag(type: RiskFlagType, role: AgentRole): boolean {
  const minimum = RISK_FLAG_CLEAR_MIN_ROLE[RISK_FLAG_DEFAULTS[type].clearer];
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Whether a member reads a flag's note, its evidence and the reason it was
 * cleared (AI-27 "Görünürlük", RL-02): what a player said about their health
 * or their gambling is for the Responsible Gaming team and a Team Lead and up.
 * Everyone who sees the conversation sees that it is flagged, and with what.
 */
export function canSeeRiskFlagDetails(role: AgentRole, inResponsibleGamingTeam: boolean): boolean {
  return (
    inResponsibleGamingTeam || ROLE_RANK[role] >= ROLE_RANK[RISK_FLAG_CLEAR_MIN_ROLE.team_lead]
  );
}

/** `details.reason` of the 403 a clear below the type's clearer gets. */
export const RISK_FLAG_CLEAR_ROLE_REASON = 'risk_flag_clear_role';
/** `details.reason` of the 403 a clear of a flag already cleared gets. */
export const RISK_FLAG_ALREADY_CLEARED_REASON = 'risk_flag_already_cleared';

/** The addresses an urgent flag is mailed to besides the members (`risk_flag_settings.notify_emails`). */
export const RISK_FLAG_NOTIFY_EMAILS_MAX = 5;

/**
 * What a raised or cleared flag says outside the panel — the webhook's
 * `risk_flag_raised` / `risk_flag_cleared` delivery (AI-27-S4): what it is,
 * where, and whose, by the player's key on the operator's site. Never what
 * anyone wrote: no note, no evidence, no reason, no quote of the player.
 */
export interface RiskFlagSignal {
  readonly flag_id: string;
  readonly type: RiskFlagType;
  readonly severity: RiskFlagSeverity;
  readonly scope: RiskFlagScope;
  readonly status: RiskFlagStatus;
  /** The conversation (panel "Thread ID"); null once it is gone. */
  readonly chat_id: string | null;
  /** The connection (panel "Chat ID"). */
  readonly thread_id: string | null;
  readonly member_key: string | null;
  readonly raised_at: string;
  readonly cleared_at: string | null;
}

/**
 * The realtime push of the same moment (`risk_flag_raised` /
 * `risk_flag_cleared`), to the conversation's members, the supervisors and,
 * for an urgent flag, the Responsible Gaming team: the signal, and what the
 * panel shows of the flag without asking — still nothing anyone wrote.
 *
 * Without `member_key` (tm 325.6): it is the player's folded pre-chat
 * username, and one frame reaches every recipient while
 * `customers.contact.view` is a per-person answer. The panel reads it, masked
 * or not, from `GET /risk-flags`.
 */
export interface RiskFlagPush extends Omit<RiskFlagSignal, 'member_key'> {
  readonly customer_id: string | null;
  readonly source: RiskFlagSource;
  readonly rule_ref: string | null;
  readonly basis: RiskFlagBasis;
}

/** A flag as {@link riskPolicy} reads it — a `risk_flags` row, or its API shape. */
export interface RiskPolicyFlag {
  readonly type: RiskFlagType;
  readonly scope: RiskFlagScope;
  /** The chat it was raised in; null once that chat is gone (retention). */
  readonly chat_id: string | null;
  /** The row's own; the type's default when absent. */
  readonly severity?: RiskFlagSeverity;
  /** Absent counts as `active`. */
  readonly status?: RiskFlagStatus;
}

export interface RiskPolicy {
  readonly noPromotions: boolean;
  readonly noBonusTalk: boolean;
  readonly mustHandoff: boolean;
  /** The hand-over's priority (`GUARDRAIL_PRIORITIES`): `urgent` when an urgent flag is the conversation's. */
  readonly priority: GuardrailPriority;
  /** The most serious conversation flag's topic, for AI-12's routing; null: the usual routing. */
  readonly targetTeamKey: GuardrailHandoffTopic | null;
}

const SEVERITY_RANK: Readonly<Record<RiskFlagSeverity, number>> = Object.freeze({
  info: 0,
  high: 1,
  urgent: 2,
});

/**
 * What a set of flags means for one conversation (AI-27 §3). `chatId` is the
 * conversation's (`chats.id`); null where there is none yet — the widget's
 * configuration, the campaign engine.
 *
 * Two kinds of flag count, the cleared ones never:
 *
 *   - the conversation's own — raised in `chatId`, of either scope: they decide
 *     everything, including the hand-over, its priority and its team;
 *   - the player's — `member` flags raised in any conversation: they keep
 *     promotions and bonus talk off, and nothing else. A player flagged
 *     yesterday is talked to today, without a promotion (AI-27 §6).
 *
 * A `chat` flag of another conversation does not count. Priority is `urgent`
 * or `normal`: `high` is AI-12's for a repeat contact or an angry player, no
 * flag's — as the guardrail catalogue's (`GUARDRAIL_PRIORITIES`). Of several
 * conversation flags the team is the most serious one's, ties to the earlier
 * type in {@link RISK_FLAG_TYPES}.
 */
export function riskPolicy(flags: readonly RiskPolicyFlag[], chatId: string | null): RiskPolicy {
  let noPromotions = false;
  let noBonusTalk = false;
  let mustHandoff = false;
  let urgent = false;
  let lead: { rank: number; order: number; topic: GuardrailHandoffTopic } | null = null;

  for (const flag of flags) {
    if (flag.status === 'cleared') continue;
    const defaults = RISK_FLAG_DEFAULTS[flag.type];
    const own = chatId !== null && flag.chat_id === chatId;
    if (!own && flag.scope !== 'member') continue;

    noPromotions ||= defaults.noPromotions;
    noBonusTalk ||= defaults.noBonusTalk;
    if (!own) continue;

    mustHandoff ||= defaults.mustHandoff;
    const severity = flag.severity ?? defaults.severity;
    urgent ||= severity === 'urgent';
    if (defaults.topic !== null) {
      const rank = SEVERITY_RANK[severity];
      const order = RISK_FLAG_TYPES.indexOf(flag.type);
      if (lead === null || rank > lead.rank || (rank === lead.rank && order < lead.order)) {
        lead = { rank, order, topic: defaults.topic };
      }
    }
  }

  return {
    noPromotions,
    noBonusTalk,
    mustHandoff,
    priority: urgent ? 'urgent' : 'normal',
    targetTeamKey: lead?.topic ?? null,
  };
}
