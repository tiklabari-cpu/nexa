/**
 * The workspace's hand-over rules in a turn (tm 303.3 · AI-09; owner decision
 * K9 · `@siyahtus/types` `handoff-rules.ts`). Pure: the rules reach a turn
 * through its configuration (`TurnConfig.handoff.rules`, ADR-14b §2.6) —
 * active ones only, in their order — and the first that matches decides.
 *
 *   - {@link inputRule} — before any model is asked: a topic or a phrase in
 *     the player's message, a risk flag the conversation carries, the
 *     procedure in progress. The rule hands over, reason `tenant_rule`.
 *   - {@link procedureRule} — once the understanding call names a procedure.
 *   - {@link routingRule} — at the end of a turn the AI hands over for its own
 *     reasons: the AI could not solve it (`ai_unresolved`), the player asked
 *     for a person (`player_request`). The rule sends it to its team with its
 *     priority; the reasons stay the AI's.
 *
 * Words are matched on the guardrails' folded text (case, Turkish letters,
 * punctuation), word by word, each word of the rule matching the start of a
 * word of the message in a row — Turkish adds its endings to the word, so
 * "para yatır" matches "Paramı yatırdım" and "şifre" matches "şifremi".
 */
import {
  AI_UNRESOLVED_HANDOFF_REASONS,
  foldGuardrailText,
  type GuardrailPriority,
  type HandoffReason,
  type HandoffRuleTarget,
  type HandoffRuleTopic,
  type HandoffRuleTrigger,
  type RiskFlagType,
} from '@siyahtus/types';

/** A rule as the turn carries it — an active one, in its place in the list. */
export interface HandoffRuleConfig {
  readonly id: string;
  readonly title: string;
  readonly trigger: HandoffRuleTrigger;
  readonly target: HandoffRuleTarget | null;
  readonly priority: GuardrailPriority;
}

/**
 * Each topic's words, Turkish and English, as folded word starts. A topic is
 * named in the player's own words; the understanding call reads no topic of
 * its own (it names procedures — `procedure` rules).
 */
const TOPIC_WORDS: Readonly<Record<HandoffRuleTopic, readonly string[]>> = Object.freeze({
  deposit: [
    'yatir',
    'yatm',
    'para yat',
    'para yukle',
    'bakiye yukle',
    'deposit',
    'top up',
    'topup',
  ],
  withdrawal: [
    'cekim',
    'para cek',
    'cektim',
    'cekemiyorum',
    'withdraw',
    'cash out',
    'cashout',
    'payout',
  ],
  account_recovery: [
    'sifre',
    'parola',
    'giremiyorum',
    'giris yapamiyorum',
    'hesabim kilit',
    'password',
    'locked out',
    "can't log",
    'cannot log',
    'unable to log',
  ],
  bonus: ['bonus', 'free spin', 'freespin', 'promosyon', 'cevrim', 'kampanya'],
  verification: ['kimlik', 'dogrula', 'belge', 'kyc', 'verif', 'identity', 'document'],
});

/** The folded words of a text. */
function wordsOf(text: string): string[] {
  return foldGuardrailText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/** Whether `words` holds `pattern`'s words in a row, each the start of a word. */
function holds(words: readonly string[], pattern: readonly string[]): boolean {
  if (pattern.length === 0) return false;
  for (let at = 0; at + pattern.length <= words.length; at += 1) {
    if (pattern.every((part, index) => (words[at + index] as string).startsWith(part))) {
      return true;
    }
  }
  return false;
}

/** Whether the message holds the phrase (a `phrase` rule's value). */
export function holdsPhrase(text: string, phrase: string): boolean {
  return holds(wordsOf(text), wordsOf(phrase));
}

/** Whether the message is about the topic (a `topic` rule's value). */
export function mentionsTopic(text: string, topic: HandoffRuleTopic): boolean {
  const words = wordsOf(text);
  return TOPIC_WORDS[topic].some((pattern) => holds(words, wordsOf(pattern)));
}

/**
 * The first rule the input sets off: a topic or a phrase in the message, a
 * risk flag the conversation carries, the procedure in progress.
 */
export function inputRule(
  rules: readonly HandoffRuleConfig[],
  input: {
    text: string;
    activeProcedureId: string | null;
    riskFlags: readonly RiskFlagType[];
  },
): HandoffRuleConfig | null {
  const words = wordsOf(input.text);
  for (const rule of rules) {
    const { trigger } = rule;
    switch (trigger.type) {
      case 'topic':
        if (TOPIC_WORDS[trigger.value].some((pattern) => holds(words, wordsOf(pattern)))) {
          return rule;
        }
        break;
      case 'phrase':
        if (holds(words, wordsOf(trigger.value))) return rule;
        break;
      case 'risk_flag':
        if (input.riskFlags.includes(trigger.value)) return rule;
        break;
      case 'procedure':
        if (trigger.value === input.activeProcedureId) return rule;
        break;
      default:
        break;
    }
  }
  return null;
}

/** The first `procedure` rule for the procedure the understanding call named. */
export function procedureRule(
  rules: readonly HandoffRuleConfig[],
  procedureKey: string | null,
): HandoffRuleConfig | null {
  if (procedureKey === null) return null;
  return (
    rules.find(
      (rule) => rule.trigger.type === 'procedure' && rule.trigger.value === procedureKey,
    ) ?? null
  );
}

const UNRESOLVED: ReadonlySet<HandoffReason> = new Set(AI_UNRESOLVED_HANDOFF_REASONS);

/**
 * The first routing rule for a hand-over the AI makes for its own reasons —
 * none for one a rule made itself (`tenant_rule`).
 */
export function routingRule(
  rules: readonly HandoffRuleConfig[],
  reasons: readonly HandoffReason[],
): HandoffRuleConfig | null {
  if (reasons.includes('tenant_rule')) return null;
  return (
    rules.find(
      (rule) =>
        (rule.trigger.type === 'player_request' && reasons.includes('player_request')) ||
        (rule.trigger.type === 'ai_unresolved' && reasons.some((reason) => UNRESOLVED.has(reason))),
    ) ?? null
  );
}

/** The hand-over side effect's fields a rule sets: its team or topic. */
export function ruleTarget(rule: HandoffRuleConfig): { groupId?: number; topic?: string } {
  const { target } = rule;
  if (target && 'group_id' in target) return { groupId: target.group_id };
  if (target && 'topic' in target) return { topic: target.topic };
  return {};
}

const PRIORITY_RANK: Readonly<Record<GuardrailPriority, number>> = Object.freeze({
  normal: 0,
  high: 1,
  urgent: 2,
});

/** The more urgent of two priorities. */
export function morePressing(a: GuardrailPriority, b: GuardrailPriority): GuardrailPriority {
  return PRIORITY_RANK[b] > PRIORITY_RANK[a] ? b : a;
}
