import { describe, expect, it } from 'vitest';
import { AI_RETURN_BLOCKING_RISK_FLAGS } from './ai-conversation.js';
import { AGENT_ROLES, type AgentRole } from './domain.js';
import {
  GUARDRAIL_HANDOFF_TOPICS,
  GUARDRAIL_PRIORITIES,
  GUARDRAIL_RISK_FLAGS,
  PLATFORM_GUARDRAILS,
  UNDERSTAND_RISK_FLAGS,
} from './guardrails.js';
import { INTEGRATION_TRIGGERS } from './integrations.js';
import { RTM_PUSH_ACTIONS } from './rtm.js';
import {
  canClearRiskFlag,
  canSeeRiskFlagDetails,
  isRiskFlagType,
  RISK_FLAG_CLEAR_MIN_ROLE,
  RISK_FLAG_CLEARERS,
  RISK_FLAG_DEFAULTS,
  RISK_FLAG_NOTIFY_EMAILS_MAX,
  RISK_FLAG_SEVERITIES,
  RISK_FLAG_TYPES,
  riskPolicy,
  type RiskFlagSignal,
  type RiskFlagType,
  type RiskPolicyFlag,
} from './risk-flags.js';

const HERE = 'c00000000001';
const YESTERDAY = 'c00000000002';

/** A flag of `type` as its type's default raises it, in `chat`. */
const flag = (
  type: RiskFlagType,
  chat: string | null = HERE,
  extra: Partial<RiskPolicyFlag> = {},
): RiskPolicyFlag => ({ type, scope: RISK_FLAG_DEFAULTS[type].scope, chat_id: chat, ...extra });

const NONE = {
  noPromotions: false,
  noBonusTalk: false,
  mustHandoff: false,
  priority: 'normal',
  targetTeamKey: null,
};

describe('risk flag types (AI-27 · tm 302.1)', () => {
  it('has defaults for every type and no other', () => {
    expect(Object.keys(RISK_FLAG_DEFAULTS)).toEqual([...RISK_FLAG_TYPES]);
    expect(Object.isFrozen(RISK_FLAG_DEFAULTS)).toBe(true);
    for (const type of RISK_FLAG_TYPES) {
      const d = RISK_FLAG_DEFAULTS[type];
      expect(RISK_FLAG_SEVERITIES, type).toContain(d.severity);
      expect(RISK_FLAG_CLEARERS, type).toContain(d.clearer);
      if (d.topic !== null) expect(GUARDRAIL_HANDOFF_TOPICS, type).toContain(d.topic);
    }
  });

  it('keeps the player-level flags to the three AI-27-S1 names, each cleared by a Manager', () => {
    const member = RISK_FLAG_TYPES.filter((t) => RISK_FLAG_DEFAULTS[t].scope === 'member');
    expect(member).toEqual(['rg_signal', 'self_exclusion_request', 'underage_suspected']);
    const manager = RISK_FLAG_TYPES.filter((t) => RISK_FLAG_DEFAULTS[t].clearer === 'manager');
    expect(manager).toEqual(member);
  });

  it('marks self-harm, a suspected minor and a self-exclusion request urgent', () => {
    const urgent = RISK_FLAG_TYPES.filter((t) => RISK_FLAG_DEFAULTS[t].severity === 'urgent');
    expect(urgent.sort()).toEqual(['self_exclusion_request', 'self_harm', 'underage_suspected']);
  });

  it('hands over on exactly the flags that keep a conversation from going back to the AI', () => {
    const handoff = RISK_FLAG_TYPES.filter((t) => RISK_FLAG_DEFAULTS[t].mustHandoff);
    expect(handoff.sort()).toEqual([...AI_RETURN_BLOCKING_RISK_FLAGS].sort());
  });

  it('holds every flag a guardrail or the understanding call raises', () => {
    for (const name of GUARDRAIL_RISK_FLAGS) expect(isRiskFlagType(name), name).toBe(true);
    for (const name of Object.values(UNDERSTAND_RISK_FLAGS)) {
      expect(isRiskFlagType(name), name).toBe(true);
    }
    expect(isRiskFlagType('responsible_gambling')).toBe(false);
    expect(isRiskFlagType(undefined)).toBe(false);
  });

  it("routes and prioritises a rule's flag as the rule does", () => {
    for (const rule of PLATFORM_GUARDRAILS) {
      if (rule.riskFlag === null) continue;
      const policy = riskPolicy([flag(rule.riskFlag)], HERE);
      expect(policy.priority, rule.id).toBe(rule.priority);
      expect(policy.targetTeamKey, rule.id).toBe(rule.target);
      expect(GUARDRAIL_PRIORITIES, rule.id).toContain(policy.priority);
    }
  });
});

describe('who may clear a flag (AI-27-S2 · tm 302.1)', () => {
  it('is a Manager (admin) and up for every type until RL-03 bounds the Team Lead', () => {
    expect(RISK_FLAG_CLEAR_MIN_ROLE).toEqual({ manager: 'admin', team_lead: 'admin' });
    const allowed = (type: RiskFlagType): AgentRole[] =>
      AGENT_ROLES.filter((role) => canClearRiskFlag(type, role));
    for (const type of RISK_FLAG_TYPES) {
      expect(allowed(type), type).toEqual(['owner', 'viceowner', 'admin']);
    }
  });
});

describe('riskPolicy (AI-27 §3 · tm 302.1)', () => {
  it('means nothing without flags', () => {
    expect(riskPolicy([], HERE)).toEqual(NONE);
    expect(riskPolicy([], null)).toEqual(NONE);
  });

  it('hands a self-exclusion request over, urgently, to responsible gaming, with no bonus talk (AI-27 acceptance)', () => {
    expect(riskPolicy([flag('self_exclusion_request')], HERE)).toEqual({
      noPromotions: true,
      noBonusTalk: true,
      mustHandoff: true,
      priority: 'urgent',
      targetTeamKey: 'responsible_gaming',
    });
  });

  it("keeps yesterday's member flag on: no promotion, no bonus talk — but the AI talks", () => {
    for (const type of ['rg_signal', 'self_exclusion_request', 'underage_suspected'] as const) {
      expect(riskPolicy([flag(type, YESTERDAY)], HERE), type).toEqual({
        ...NONE,
        noPromotions: true,
        noBonusTalk: true,
      });
      // The widget and the campaign engine, before any conversation.
      expect(riskPolicy([flag(type, YESTERDAY)], null).noPromotions, type).toBe(true);
    }
  });

  it('keeps a member flag on once its chat is gone', () => {
    expect(riskPolicy([flag('rg_signal', null)], HERE).noPromotions).toBe(true);
  });

  it("ignores another conversation's chat flag", () => {
    expect(riskPolicy([flag('self_harm', YESTERDAY)], HERE)).toEqual(NONE);
    expect(riskPolicy([flag('self_harm', YESTERDAY)], null)).toEqual(NONE);
    expect(riskPolicy([flag('complaint_formal', YESTERDAY)], HERE)).toEqual(NONE);
  });

  it('ignores a cleared flag', () => {
    expect(riskPolicy([flag('self_exclusion_request', HERE, { status: 'cleared' })], HERE)).toEqual(
      NONE,
    );
    expect(
      riskPolicy([flag('rg_signal', YESTERDAY, { status: 'cleared' })], null).noPromotions,
    ).toBe(false);
  });

  it('suppresses no campaign and no bonus talk for a complaint, fraud or abuse — and does not hand over', () => {
    for (const type of [
      'complaint_formal',
      'fraud_suspected',
      'account_takeover_suspected',
      'multi_account',
      'abusive',
      'account_security',
    ] as const) {
      const policy = riskPolicy([flag(type)], HERE);
      expect(policy.noPromotions, type).toBe(false);
      expect(policy.noBonusTalk, type).toBe(false);
      expect(policy.mustHandoff, type).toBe(false);
      expect(policy.targetTeamKey, type).toBe(RISK_FLAG_DEFAULTS[type].topic);
    }
  });

  it("takes the row's own severity over its type's", () => {
    expect(riskPolicy([flag('fraud_suspected', HERE, { severity: 'urgent' })], HERE).priority).toBe(
      'urgent',
    );
    expect(riskPolicy([flag('self_harm', HERE, { severity: 'high' })], HERE).priority).toBe(
      'normal',
    );
  });

  it('never makes a member flag of another conversation urgent here', () => {
    expect(riskPolicy([flag('underage_suspected', YESTERDAY)], HERE).priority).toBe('normal');
  });

  it('sends the hand-over to the most serious flag, ties to the earlier type', () => {
    expect(riskPolicy([flag('complaint_formal'), flag('self_harm')], HERE).targetTeamKey).toBe(
      'responsible_gaming',
    );
    // Both high: complaint comes before fraud in RISK_FLAG_TYPES.
    expect(
      riskPolicy([flag('fraud_suspected'), flag('complaint_formal')], HERE).targetTeamKey,
    ).toBe('complaints');
    // A raised severity outranks the order.
    expect(
      riskPolicy(
        [flag('complaint_formal'), flag('fraud_suspected', HERE, { severity: 'urgent' })],
        HERE,
      ).targetTeamKey,
    ).toBe('kyc_risk');
    // A flag with no topic does not take the team.
    expect(
      riskPolicy([flag('abusive', HERE, { severity: 'urgent' }), flag('multi_account')], HERE)
        .targetTeamKey,
    ).toBe('kyc_risk');
    // A member flag of another conversation does not either.
    expect(
      riskPolicy([flag('self_exclusion_request', YESTERDAY), flag('complaint_formal')], HERE),
    ).toEqual({ ...NONE, noPromotions: true, noBonusTalk: true, targetTeamKey: 'complaints' });
  });
});

describe('who reads a flag’s note and evidence (AI-27 “Görünürlük” · tm 302.2)', () => {
  it('the Responsible Gaming team and a Team Lead and up (admin until RL-03); a Team Member reads the type only', () => {
    const read = (role: AgentRole, team: boolean) => canSeeRiskFlagDetails(role, team);
    // `team_lead` exists since tm 324.1 but still reads as a member here:
    // `RISK_FLAG_CLEAR_MIN_ROLE.team_lead` stays `admin` until it moves down.
    expect(AGENT_ROLES.filter((role) => read(role, false))).toEqual([
      'owner',
      'viceowner',
      'admin',
    ]);
    expect(read('agent', false)).toBe(false);
    expect(read('agent', true)).toBe(true);
  });
});

describe('what a flag says outside the panel (AI-27-S4 · tm 302.2)', () => {
  it('the webhook samples carry what, where and whose — never a word anyone wrote', () => {
    const samples = INTEGRATION_TRIGGERS.filter((trigger) =>
      trigger.action.startsWith('risk_flag_'),
    );
    expect(samples.map((trigger) => trigger.action)).toEqual([
      'risk_flag_raised',
      'risk_flag_cleared',
    ]);
    const signal: Record<keyof RiskFlagSignal, true> = {
      flag_id: true,
      type: true,
      severity: true,
      scope: true,
      status: true,
      chat_id: true,
      thread_id: true,
      member_key: true,
      raised_at: true,
      cleared_at: true,
    };
    for (const trigger of samples) {
      expect(Object.keys(trigger.sample_payload['data'] as object).sort()).toEqual(
        Object.keys(signal).sort(),
      );
    }
    expect(RTM_PUSH_ACTIONS).toEqual(
      expect.arrayContaining(['risk_flag_raised', 'risk_flag_cleared']),
    );
    expect(RISK_FLAG_NOTIFY_EMAILS_MAX).toBe(5);
  });
});
