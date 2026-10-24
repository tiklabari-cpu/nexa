/**
 * What the risk-flag screens (tm 302.3 · AI-27) decide without drawing
 * anything: which flags a conversation shows, in what order, who may clear
 * one, and which words a refusal is shown in.
 *
 * A flag is the server's word. The panel never works out a severity, a scope
 * or a policy of its own: it reads them off the flag and, for the one
 * question it must answer before the server does — "is there a Clear button
 * for this person?" — asks the same `canClearRiskFlag` the route asks.
 */
import {
  AGENT_ROLES,
  RISK_FLAG_ALREADY_CLEARED_REASON,
  RISK_FLAG_CLEAR_MIN_ROLE,
  RISK_FLAG_CLEAR_ROLE_REASON,
  RISK_FLAG_DEFAULTS,
  RISK_FLAG_TYPES,
  canClearRiskFlag,
  type AgentRole,
  type PromoPolicy,
  type RiskFlagBasis,
  type RiskFlagScope,
  type RiskFlagSeverity,
  type RiskFlagSource,
  type RiskFlagStatus,
  type RiskFlagType,
} from '@siyahtus/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';

/** A flag as `GET /risk-flags` and `GET /customers/{id}/risk-flags` return it (`RiskFlag`). */
export interface RiskFlagItem {
  id: string;
  scope: RiskFlagScope;
  chat_id: string | null;
  thread_id: string | null;
  customer_id: string | null;
  member_key: string | null;
  type: RiskFlagType;
  severity: RiskFlagSeverity;
  source: RiskFlagSource;
  rule_ref: string | null;
  basis: RiskFlagBasis;
  status: RiskFlagStatus;
  raised_by: string | null;
  raised_at: string;
  cleared_by: string | null;
  cleared_at: string | null;
  /** Null unless `details_visible`: what was written about the player is for the few. */
  note: string | null;
  evidence_event_ids: string[] | null;
  clear_reason: string | null;
  details_visible: boolean;
}

/** One page of either list. */
export interface RiskFlagPage {
  items: RiskFlagItem[];
  next_page_id?: string;
}

/**
 * A player's list (`GET /customers/{id}/risk-flags`): the page, and whether
 * the player is shown campaigns (EN-01 · tm 350) — the server's answer, over
 * every flag of theirs and of the records linked to them, which this panel
 * may not all see.
 */
export interface CustomerRiskFlagPage extends RiskFlagPage {
  promo_suppressed: boolean;
  promo_suppressed_reason: RiskFlagType | null;
}

/** `GET|PUT /risk-flags/settings`. */
export interface RiskFlagSettingsData {
  rg_group_id: number | null;
  notify_emails: string[];
  /** Which of the workspace's two types keep a player from campaigns (EN-01). */
  promo_block: PromoPolicy;
  updated_by: string | null;
  updated_at: string | null;
}

/** The query keys: `['risk-flags']` is the prefix a push invalidates. */
export const RISK_FLAGS_KEY = ['risk-flags'] as const;
export const chatRiskFlagsKey = (chatId: string) => ['risk-flags', 'chat', chatId] as const;
export const customerRiskFlagsKey = (customerId: string) =>
  ['risk-flags', 'customer', customerId] as const;
export const RISK_FLAG_SETTINGS_KEY = ['settings', 'risk-flags'] as const;

/** Most urgent first: how chips and the list are ordered. */
const SEVERITY_RANK: Record<RiskFlagSeverity, number> = { urgent: 0, high: 1, info: 2 };

export function isRiskFlagType(value: string): value is RiskFlagType {
  return (RISK_FLAG_TYPES as readonly string[]).includes(value);
}

/**
 * The flags a conversation shows: its own active flags, and the player's
 * active member flags raised in an earlier conversation (the "ertesi gün"
 * case — the player was flagged yesterday and is back today). Cleared flags
 * are history, not state, and are left out. Urgent first, then newest.
 */
export function activeFlagsOf(
  chatFlags: readonly RiskFlagItem[],
  memberFlags: readonly RiskFlagItem[],
): RiskFlagItem[] {
  const byId = new Map<string, RiskFlagItem>();
  for (const flag of chatFlags) {
    if (flag.status === 'active') byId.set(flag.id, flag);
  }
  for (const flag of memberFlags) {
    if (flag.status === 'active' && flag.scope === 'member') byId.set(flag.id, flag);
  }
  return [...byId.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.raised_at.localeCompare(a.raised_at) ||
      a.id.localeCompare(b.id),
  );
}

/** Whether a flag was raised in another conversation of the same player. */
export function isFromEarlierChat(flag: RiskFlagItem, chatId: string): boolean {
  return flag.chat_id !== chatId;
}

/** The types an agent can still flag a conversation with: one active flag per type. */
export function flaggableTypes(active: readonly RiskFlagItem[], chatId: string): RiskFlagType[] {
  const held = new Set(
    active.filter((flag) => !isFromEarlierChat(flag, chatId)).map((flag) => flag.type),
  );
  return RISK_FLAG_TYPES.filter((type) => !held.has(type));
}

function asAgentRole(role: string | null): AgentRole | null {
  return role !== null && (AGENT_ROLES as readonly string[]).includes(role)
    ? (role as AgentRole)
    : null;
}

/** Whether the caller gets a "Clear" button for a flag — the route's own rule. */
export function mayClear(flag: Pick<RiskFlagItem, 'type'>, role: string | null): boolean {
  const known = asAgentRole(role);
  return known !== null && canClearRiskFlag(flag.type, known);
}

/** The lowest role that clears a flag of this type, for "only … and up" copy. */
export function clearerRole(type: RiskFlagType): AgentRole {
  return RISK_FLAG_CLEAR_MIN_ROLE[RISK_FLAG_DEFAULTS[type].clearer];
}

/** Whether clearing this flag leaves the operator's decision as it was (AI-27-S2). */
export function isSelfExclusion(type: RiskFlagType): boolean {
  return type === 'self_exclusion_request';
}

/** Whether the flag speaks of the player rather than the conversation, and so stays on them. */
export function staysOnPlayer(type: RiskFlagType): boolean {
  return RISK_FLAG_DEFAULTS[type].scope === 'member';
}

/** What a flag of this type does, as the panel words it: the policy booleans, in catalogue keys. */
export function policyKeys(type: RiskFlagType): string[] {
  const defaults = RISK_FLAG_DEFAULTS[type];
  const keys: string[] = [];
  if (defaults.mustHandoff) keys.push('inbox.risk.policy.mustHandoff');
  if (defaults.noBonusTalk) keys.push('inbox.risk.policy.noBonusTalk');
  if (defaults.noPromotions) keys.push('inbox.risk.policy.noPromotions');
  return keys;
}

/**
 * The catalogue key that answers a failed risk-flag call. A clear below the
 * type's clearer (403 `authorization`, `risk_flag_clear_role`) and a second
 * clear (403 `not_allowed`, `risk_flag_already_cleared`) each have a sentence
 * of their own; everything else is the generic one for its type.
 */
export function riskFlagErrorKey(error: unknown): string {
  if (error instanceof ApiClientError) {
    const reason = error.details?.['reason'];
    if (reason === RISK_FLAG_CLEAR_ROLE_REASON) return 'inbox.risk.error.clearRole';
    if (reason === RISK_FLAG_ALREADY_CLEARED_REASON) return 'inbox.risk.error.alreadyCleared';
  }
  return errorMessageKey(error);
}

/** The addresses field, as typed, to the list the server takes (trimmed, lower-cased, unique). */
export function parseEmailList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim().toLowerCase();
    if (address) seen.add(address);
  }
  return [...seen];
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first address that cannot be one, or null. */
export function firstBadEmail(addresses: readonly string[]): string | null {
  return addresses.find((address) => !EMAIL_SHAPE.test(address) || address.length > 254) ?? null;
}
