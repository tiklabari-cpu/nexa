/**
 * Skill execution (PRD flow 3).
 *
 * Runs an active skill's steps against an incoming customer message. The
 * outcome is one of three things, and the distinction matters to billing:
 *
 *   answered  — the AI replied and the conversation stands on its own. If the
 *               thread later closes with no agent-authored event this counts as
 *               an AI resolution (ADR-09), which is what the invoice meters.
 *   handed_off— the AI decided a human is needed and transferred.
 *   skipped   — no skill matched. Routing proceeds exactly as before.
 *
 * The engine never decides *not* to involve a human on its own. `send_message`
 * answers; only an explicit `transfer_to_team` step, or the absence of any
 * answer, changes who owns the conversation.
 */
import { matchIntent, validateSteps, type SendMessageStep, type SkillStep } from '@nexa/ai-mock';
import {
  ANSWER_BUDGETS,
  DEFAULT_ANSWER_PASSAGES,
  personaLanguageVerdict,
  readPersona,
  shapeAnswer,
  type Persona,
  type PersonaLanguage,
} from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { KnowledgeService, RETRIEVAL_THRESHOLD } from './knowledge-service.js';

export type SkillOutcome = 'answered' | 'handed_off' | 'skipped';

export interface SkillRunLogEntry {
  step: string;
  detail: string;
  /** False when the step could not do its job — surfaced in the run log UI. */
  ok: boolean;
}

export interface SkillRunResult {
  outcome: SkillOutcome;
  skillId: string | null;
  skillName: string | null;
  /** Text the AI wants to send, if any. The caller writes it as an event. */
  reply: string | null;
  /** Tags to apply to the thread. */
  tags: string[];
  /** Team to transfer to, when the skill handed off. */
  transferTo: string | null;
  summary: string | null;
  log: SkillRunLogEntry[];
}

const NOTHING_RAN: SkillRunResult = {
  outcome: 'skipped',
  skillId: null,
  skillName: null,
  reply: null,
  tags: [],
  transferTo: null,
  summary: null,
  log: [],
};

export class SkillEngine {
  constructor(private readonly knowledge = new KnowledgeService()) {}

  /**
   * Pick and run the first matching skill.
   *
   * Only one skill runs per message. Running several would let two of them
   * reply to the same question, and an admin debugging why a customer got two
   * different answers has no way to see which fired first.
   */
  async run(
    tx: TenantClient,
    tenant: TenantContext,
    input: { message: string; chatId: string; history?: string[] },
  ): Promise<SkillRunResult> {
    const skills = await tx.skill.findMany({
      where: { active: true, kind: 'ai_agent', aiAgent: { active: true } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        steps: true,
        aiAgentId: true,
        // The persona travels with the skill because it belongs to the agent
        // that owns it: two agents in one workspace answer in two voices, so
        // "which persona applies" is only decidable once a skill has been
        // picked (FR-MOD-06.4).
        aiAgent: { select: { tone: true, languages: true, persona: true } },
      },
    });

    for (const skill of skills) {
      const parsed = validateSteps(skill.steps);
      if (!parsed.ok) {
        // A malformed skill is skipped rather than crashing the message path —
        // a customer must never lose a message because an admin saved a broken
        // step list.
        continue;
      }

      const gate = this.#intentGate(parsed.steps, input.message);
      if (!gate.matched) continue;

      const persona = readPersona(skill.aiAgent);
      const language = personaLanguageVerdict(input.message, persona);
      const identity = { id: skill.id, name: skill.name, aiAgentId: skill.aiAgentId };

      // The persona names the languages this assistant speaks. A message
      // confidently in another one is the case the setting exists for, and the
      // honest answer is not a reply in the wrong language — there is no
      // translation here, only knowledge in whatever language the admin loaded.
      // Declining leaves the outcome `skipped`, so routing proceeds exactly as
      // it would with no AI and a human picks the conversation up.
      const result = language.unsupported
        ? declined(identity, gate.log, language.detected)
        : await this.#execute(tx, tenant, {
            skill: identity,
            steps: parsed.steps,
            message: input.message,
            history: input.history ?? [],
            gateLog: gate.log,
            persona,
            answerIn: language.answerIn,
          });

      await this.#record(tx, tenant, skill.id, input.chatId, result);
      return result;
    }

    return NOTHING_RAN;
  }

  /**
   * Dry run for the editor's Preview (FR-MOD-06.2.5).
   *
   * Same code path, no writes: an admin needs to see what the skill would
   * actually do, and a preview that runs different logic is worse than none.
   */
  async preview(
    tx: TenantClient,
    tenant: TenantContext,
    input: { steps: unknown; message: string; aiAgentId?: string | null },
  ): Promise<SkillRunResult & { errors: string[] }> {
    const parsed = validateSteps(input.steps);
    if (!parsed.ok) {
      return {
        ...NOTHING_RAN,
        errors: [parsed.index >= 0 ? `Step ${parsed.index + 1}: ${parsed.reason}` : parsed.reason],
      };
    }

    const gate = this.#intentGate(parsed.steps, input.message);
    if (!gate.matched) {
      return {
        ...NOTHING_RAN,
        log: gate.log,
        errors: [],
      };
    }

    // The preview loads the same persona the live path would, for the same
    // reason the preview shares this method at all: a preview that shows an
    // unshaped answer promises something the product does not do.
    const agent = input.aiAgentId
      ? await tx.aiAgent.findFirst({
          where: { id: input.aiAgentId },
          select: { tone: true, languages: true, persona: true },
        })
      : null;
    const persona = readPersona(agent);
    const language = personaLanguageVerdict(input.message, persona);
    const identity = { id: 'preview', name: 'Preview', aiAgentId: input.aiAgentId ?? null };

    if (language.unsupported) {
      return { ...declined(identity, gate.log, language.detected), errors: [] };
    }

    const result = await this.#execute(tx, tenant, {
      skill: identity,
      steps: parsed.steps,
      message: input.message,
      history: [],
      gateLog: gate.log,
      persona,
      answerIn: language.answerIn,
    });

    return { ...result, errors: [] };
  }

  /** `detect_intent` steps gate the whole skill; all of them must match. */
  #intentGate(steps: SkillStep[], message: string): { matched: boolean; log: SkillRunLogEntry[] } {
    const gates = steps.filter((step) => step.type === 'detect_intent');
    // No gate means the skill applies to everything — which is a legitimate
    // choice for a single catch-all skill.
    if (gates.length === 0) return { matched: true, log: [] };

    const log: SkillRunLogEntry[] = [];
    let matched = true;

    for (const gate of gates) {
      const result = matchIntent(message, gate.intent, gate.phrases ?? []);
      log.push({
        step: 'detect_intent',
        detail: result.matched
          ? `matched "${gate.intent}" (${result.score}) on ${result.hits.join(', ')}`
          : `no match for "${gate.intent}" (${result.score})`,
        ok: result.matched,
      });
      if (!result.matched) matched = false;
    }

    return { matched, log };
  }

  async #execute(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      skill: { id: string; name: string; aiAgentId: string | null };
      steps: SkillStep[];
      message: string;
      history: string[];
      gateLog: SkillRunLogEntry[];
      persona: Persona;
      answerIn: PersonaLanguage | null;
    },
  ): Promise<SkillRunResult> {
    const log = [...input.gateLog];
    const tags: string[] = [];
    let reply: string | null = null;
    let transferTo: string | null = null;
    let summary: string | null = null;

    for (const step of input.steps) {
      // A transfer ends the skill: everything after it would be acting on a
      // conversation the AI no longer owns.
      if (transferTo) {
        log.push({ step: step.type, detail: 'skipped — already handed off', ok: true });
        continue;
      }

      switch (step.type) {
        case 'detect_intent':
          break; // Already evaluated as the gate.

        case 'tag':
          tags.push(step.tag);
          log.push({ step: 'tag', detail: `tagged "${step.tag}"`, ok: true });
          break;

        case 'request_info': {
          // Only ask if the answer is not already in the message. Asking a
          // customer for an order number they just gave is the single most
          // irritating thing an automated agent does.
          const supplied = looksSupplied(input.message, step.field);
          if (supplied) {
            log.push({
              step: 'request_info',
              detail: `${step.field} already provided`,
              ok: true,
            });
          } else {
            reply = step.prompt;
            log.push({ step: 'request_info', detail: `asked for ${step.field}`, ok: true });
          }
          break;
        }

        case 'summarize':
          summary = buildSummary(input.message, input.history);
          log.push({ step: 'summarize', detail: 'summary written', ok: true });
          break;

        case 'send_message': {
          const outcome = await this.#sendMessage(tx, tenant, step, {
            message: input.message,
            skill: input.skill,
            persona: input.persona,
            answerIn: input.answerIn,
          });
          if (outcome.text) reply = outcome.text;
          log.push({ step: 'send_message', detail: outcome.detail, ok: outcome.text !== null });
          break;
        }

        case 'transfer_to_team':
          transferTo = step.group;
          log.push({
            step: 'transfer_to_team',
            detail: `handing over to ${step.group}`,
            ok: true,
          });
          break;
      }
    }

    return {
      outcome: transferTo ? 'handed_off' : reply ? 'answered' : 'skipped',
      skillId: input.skill.id,
      skillName: input.skill.name,
      reply,
      tags,
      transferTo,
      summary,
      log,
    };
  }

  async #sendMessage(
    tx: TenantClient,
    tenant: TenantContext,
    step: SendMessageStep,
    input: {
      message: string;
      skill: { aiAgentId: string | null };
      persona: Persona;
      answerIn: PersonaLanguage | null;
    },
  ): Promise<{ text: string | null; detail: string }> {
    if (step.source === 'text') {
      // Deliberately unshaped (FR-MOD-06.4 · `#### K06.4`). A fixed reply is
      // wording an admin typed by hand and asked to be sent; trimming it to an
      // answer-length budget or prefixing it with a tone would rewrite their
      // words behind their back. The persona shapes what the assistant
      // *composes* — the passages retrieval found — never what a human wrote.
      return { text: step.text ?? null, detail: 'sent the fixed reply' };
    }

    const passages = this.#passageBudget(input.persona);
    const hits = await this.knowledge.retrieve(tx, tenant, input.message, {
      ...(input.skill.aiAgentId ? { aiAgentId: input.skill.aiAgentId } : {}),
      // Never below the two this always fetched, so an unset persona issues the
      // identical query; a `long` answer is the only thing that widens it.
      limit: Math.max(2, passages),
    });

    if (hits.length === 0) {
      // Answering from an unrelated article is worse than admitting there is no
      // answer. Returning no text leaves the outcome as `skipped`, so a human
      // picks the conversation up.
      return {
        text: null,
        detail: `nothing in the knowledge base above ${RETRIEVAL_THRESHOLD} similarity`,
      };
    }

    const best = hits[0]!;
    const shaped = shapeAnswer(
      hits.map((hit) => hit.text),
      input.persona,
      { language: input.answerIn },
    );
    const cited = hits.slice(0, Math.min(passages, hits.length));

    return {
      text: shaped.text,
      detail: [
        `answered from "${best.sourceName}" (${best.score})`,
        cited.length > 1 ? `+ ${cited.length - 1} more passage(s)` : '',
        shaped.notes.length > 0 ? `persona: ${shaped.notes.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  /** How many retrieved passages this persona's answer length pays for. */
  #passageBudget(persona: Persona): number {
    return persona.answerLength
      ? ANSWER_BUDGETS[persona.answerLength].passages
      : DEFAULT_ANSWER_PASSAGES;
  }

  async #record(
    tx: TenantClient,
    tenant: TenantContext,
    skillId: string,
    chatId: string,
    result: SkillRunResult,
  ): Promise<void> {
    // `status` answers "did the run complete?" — the schema constrains it to
    // succeeded/failed/aborted. The conversation outcome is a different
    // question ("what did it do to the chat?") and lives in the log beside the
    // steps, rather than being forced into a column that does not mean it.
    // A knowledge miss is a successful run that chose not to answer.
    await tx.skillRun.create({
      data: {
        skillId,
        chatId,
        licenseId: tenant.licenseId,
        status: result.log.some((entry) => !entry.ok && entry.step !== 'detect_intent')
          ? 'failed'
          : 'succeeded',
        log: { outcome: result.outcome, entries: result.log } as unknown as object,
      },
    });
    // The count an admin sees in the Playbook list. Incremented in the same
    // transaction so it cannot drift from the run log beside it.
    await tx.skill.update({ where: { id: skillId }, data: { runsCount: { increment: 1 } } });
  }
}

/**
 * The run where the persona declined to answer, because the customer wrote in a
 * language it does not speak (FR-MOD-06.4).
 *
 * `ok: true` on the log entry, and so a *succeeded* run: nothing failed. The
 * skill was asked a question outside the persona's declared languages and did
 * the one correct thing with it — nothing — which is a decision, not a fault,
 * and an admin reading the run log needs it to read that way. The outcome is
 * `skipped`, which is the engine's existing word for "a human owns this now".
 */
function declined(
  skill: { id: string; name: string },
  gateLog: SkillRunLogEntry[],
  detected: string | null,
): SkillRunResult {
  return {
    ...NOTHING_RAN,
    skillId: skill.id,
    skillName: skill.name,
    log: [
      ...gateLog,
      {
        step: 'persona',
        detail: `left for a human — the message is in ${detected ?? 'another language'}, which this persona does not speak`,
        ok: true,
      },
    ],
  };
}

/**
 * Whether the message already carries the field being asked for.
 *
 * Deliberately shallow — it looks for a plausible value, not a validated one.
 * The cost of a false positive is one unasked question; the cost of a false
 * negative is asking a customer for something they just typed.
 */
function looksSupplied(message: string, field: string): boolean {
  if (/order|reference|tracking|invoice/i.test(field)) {
    // An order number is a run of digits, or letters-and-digits together.
    return /\b(?=[a-z0-9-]*\d)[a-z0-9-]{5,}\b/i.test(message);
  }
  if (/email/i.test(field)) return /\S+@\S+\.\S+/.test(message);
  if (/phone|number/i.test(field)) return /\+?\d[\d\s-]{6,}/.test(message);
  return false;
}

/** A one-line summary for the agent who picks the conversation up. */
function buildSummary(message: string, history: string[]): string {
  const lines = [...history, message].filter(Boolean);
  const first = lines[0] ?? message;
  const opening = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  return lines.length > 1
    ? `Customer opened with: ${opening} (${lines.length} messages so far)`
    : `Customer asked: ${opening}`;
}
