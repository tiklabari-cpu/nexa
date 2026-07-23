/**
 * Natural language → ordered skill steps (PRD FR-MOD-06.2.3/.4).
 *
 * A rule-based stub standing in for an LLM. It reads an admin's instruction and
 * emits the step list the engine executes, so the whole path — write an
 * instruction, get steps, run them against a real message — works end to end
 * with no provider and no network.
 *
 * It is deliberately conservative. An LLM asked to compile a vague instruction
 * will invent something plausible; this reports what it could not understand
 * instead, because a skill that silently does the wrong thing to a customer is
 * worse than one that refuses to compile.
 */
import type { SkillStep } from './steps.js';

export interface CompileResult {
  steps: SkillStep[];
  /** Lines the compiler could not turn into a step. Surfaced in the editor. */
  unrecognised: string[];
}

interface Matcher {
  test: RegExp;
  build: (match: RegExpMatchArray, line: string) => SkillStep | null;
}

/**
 * Order matters: the first pattern that matches a line wins, so the more
 * specific phrasings come before the general ones. "transfer to the billing
 * team" must not be swallowed by the bare "team" mention in an earlier rule.
 */
const MATCHERS: Matcher[] = [
  {
    // "when someone asks about X" / "if the customer mentions X"
    test: /\b(?:when|if)\b.*?\b(?:asks?|mentions?|says?|wants?|about)\b\s+(?:about\s+)?["“]?([^".,;”]+)/i,
    build: (match) => {
      const intent = slug(match[1] ?? '');
      return intent ? { type: 'detect_intent', intent, phrases: phrasesOf(match[1] ?? '') } : null;
    },
  },
  {
    // "ask for their order number"
    test: /\b(?:ask|request|collect)\b\s+(?:for\s+|the\s+|their\s+)*([^.,;]+)/i,
    build: (match) => {
      const field = slug(match[1] ?? '');
      if (!field) return null;
      return {
        type: 'request_info',
        field,
        prompt: `Could you share your ${(match[1] ?? '').trim().toLowerCase()}?`,
      };
    },
  },
  {
    // "tag it as shipping" / "add the tag refund"
    test: /\btag\b\s+(?:it\s+|the\s+(?:chat|conversation)\s+)?(?:as\s+|with\s+)?["“]?([\w -]+)/i,
    build: (match) => {
      const tag = slug(match[1] ?? '');
      return tag ? { type: 'tag', tag } : null;
    },
  },
  {
    // "hand over to the billing team" / "transfer to Support"
    test: /\b(?:transfer|hand ?off|hand over|escalate|pass)\b.*?\bto\b\s+(?:the\s+)?["“]?([\w -]+?)(?:\s+team)?["”]?\s*(?:$|[.,;])/i,
    build: (match) => {
      const group = (match[1] ?? '').trim();
      return group ? { type: 'transfer_to_team', group } : null;
    },
  },
  {
    // "summarise the conversation"
    test: /\bsummar(?:ise|ize|y)\b/i,
    build: () => ({ type: 'summarize' }),
  },
  {
    // "reply with the delivery times" / "answer from the knowledge base"
    test: /\b(?:reply|answer|respond|tell them|send)\b\s*(?:with|using|from)?\s*(.*)/i,
    build: (match) => {
      const rest = (match[1] ?? '').trim();
      // "answer from the knowledge base" means retrieve; anything else is a
      // fixed message the admin wrote out.
      const fromKnowledge = /knowledge|kb|article|docs?/i.test(rest) || rest === '';
      return fromKnowledge
        ? { type: 'send_message', source: 'knowledge' }
        : { type: 'send_message', source: 'text', text: stripQuotes(rest) };
    },
  },
];

/**
 * "When a customer asks about X, do Y" — the trigger and the action in one
 * sentence, which is how people naturally write the first line. Split so both
 * halves become steps; treating the whole sentence as one would silently drop
 * the action.
 */
const TRIGGER_CLAUSE = /^\s*(?:when|if)\b[^,]*,\s*(.+)$/i;

export function compileInstruction(instruction: string): CompileResult {
  const steps: SkillStep[] = [];
  const unrecognised: string[] = [];

  const queue = splitInstruction(instruction);

  while (queue.length > 0) {
    const line = queue.shift()!;
    const built = compileLine(line);

    if (built) {
      steps.push(built);

      // A trigger sentence carries an action after the comma. Push it back so
      // it goes through the same matching, rather than being special-cased.
      if (built.type === 'detect_intent') {
        const remainder = TRIGGER_CLAUSE.exec(line)?.[1]?.trim();
        if (remainder) queue.unshift(...splitInstruction(remainder));
      }
      continue;
    }

    unrecognised.push(line);
  }

  return { steps: dedupeConsecutive(steps), unrecognised };
}

function compileLine(line: string): SkillStep | null {
  for (const matcher of MATCHERS) {
    const match = line.match(matcher.test);
    if (!match) continue;
    const built = matcher.build(match, line);
    if (built) return built;
  }
  return null;
}

/**
 * One instruction line per step.
 *
 * Split on sentence ends, newlines, list markers and "then", because that is
 * how people actually write these: "Ask for the order number, then tag it as
 * shipping."
 */
function splitInstruction(instruction: string): string[] {
  return instruction
    .split(/\n+|(?<=[.!?])\s+|\s*;\s*|\s+then\s+/i)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Collapse identical neighbouring steps.
 *
 * "Summarise it and then summarise for the team" should not produce two
 * summaries; the customer would see the work done twice.
 */
function dedupeConsecutive(steps: SkillStep[]): SkillStep[] {
  return steps.filter((step, index) => {
    const previous = steps[index - 1];
    return !previous || JSON.stringify(previous) !== JSON.stringify(step);
  });
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Words from the phrase, used to match an incoming message against the intent. */
function phrasesOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[,/]|\bor\b/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 2)
    .slice(0, 8);
}

function stripQuotes(value: string): string {
  return value.replace(/^["“']|["”']$/g, '').trim();
}
