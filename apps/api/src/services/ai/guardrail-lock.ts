/**
 * The lock on the platform's guardrails, read in a workspace rule's words
 * (tm 301.2 · SiyahTuş analysis AI-08 §9): a workspace may add stricter rules,
 * never one that switches a locked rule off. A rule that names one of G1–G19
 * (or the locked rules as a whole) and tells the AI to ignore, disable or not
 * apply it, or one that asks for a player's password or makes a bonus offer
 * mandatory, is refused with the lock's 403.
 *
 * Narrower than the behaviour rules' refusal (`lockedRuleViolation`, AI-07
 * §5) on one point, on purpose: a compliance rule is *about* the locked topics
 * — "reşit olmayan şüphesinde KYC ekibine aktarmadan önce yaş sorma" — so a
 * locked topic beside a word like "aktarma" is not enough here; the rule has
 * to name a platform rule. Like that refusal it errs towards letting a rule
 * through: a missed one still sits below the locked layer in the prompt, and
 * a workspace rule can only add a block or a hand-over, never take one away.
 */
import { foldGuardrailText, type GuardrailId } from '@siyahtus/types';
import { lockedRuleViolation } from './guidance-check.js';

export type GuardrailLockedRule = GuardrailId | 'catalogue' | 'credentials' | 'mandatory_bonus';

export interface GuardrailLoosening {
  locked_rule: GuardrailLockedRule;
  explanation: string;
}

/** A platform rule by its number: "G4", "g4'ü", "G 13" is not one. */
const NAMED_RULE = /(?<![a-z0-9])g(1[0-9]|[1-9])(?![0-9])/;
/** The locked rules as a whole. */
const CATALOGUE =
  /(kilitli kural|platform kural|koruma kural|uyum kural|guardrail|locked rule|platform rule|compliance rule)/;
/**
 * "Do not apply it" — loosening whatever else the sentence says. Not the bare
 * "uygulama": it is also the noun "app" ("yalnız mobil uygulamadan").
 */
const NOT_APPLIED =
  /(?<![a-z])(uygulamayin|uygulamayiniz|uygulanmasin|uygulanmaz|gecerli degil|do not apply|dont apply|does not apply|no longer appl)/;
/** A verb that switches a rule off, in its positive form ("yok say", not "yok sayma"). */
const LOOSEN =
  /(devre disi birak(?!ma)|yok say(?!ma)|gormezden gel(?!me)|iptal et(?!me)|askiya al(?!ma)|esnet(?!me)|gevset(?!me)|ignore|bypass|disable|override|turn off|switch off|relax)/;
/** A word that turns the loosening around: "asla yok sayma", "never ignore". */
const NEGATOR = /(?<![a-z])(asla|hicbir|never|not|dont)(?![a-z])/;

/** What the rule would loosen, or null. */
export function guardrailRuleLoosening(text: string): GuardrailLoosening | null {
  const folded = foldGuardrailText(text).replace(/[\n,]/g, ' ');
  const named = NAMED_RULE.exec(folded);
  if (named || CATALOGUE.test(folded)) {
    if (NOT_APPLIED.test(folded) || (LOOSEN.test(folded) && !NEGATOR.test(folded))) {
      const rule = named ? (`G${named[1]}` as GuardrailId) : 'catalogue';
      return {
        locked_rule: rule,
        explanation:
          rule === 'catalogue'
            ? "The platform's locked rules cannot be switched off or loosened by a workspace rule; a workspace may only add stricter ones."
            : `${rule} is a locked platform rule: a workspace rule cannot switch it off or loosen it.`,
      };
    }
  }
  const violation = lockedRuleViolation(text, { topicDisable: false });
  return violation && violation.locked_rule !== 'disable_locked'
    ? { locked_rule: violation.locked_rule, explanation: violation.explanation }
    : null;
}
