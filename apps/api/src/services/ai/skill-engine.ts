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
      select: { id: true, name: true, steps: true, aiAgentId: true },
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

      const result = await this.#execute(tx, tenant, {
        skill: { id: skill.id, name: skill.name, aiAgentId: skill.aiAgentId },
        steps: parsed.steps,
        message: input.message,
        history: input.history ?? [],
        gateLog: gate.log,
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

    const result = await this.#execute(tx, tenant, {
      skill: { id: 'preview', name: 'Preview', aiAgentId: input.aiAgentId ?? null },
      steps: parsed.steps,
      message: input.message,
      history: [],
      gateLog: gate.log,
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
          const outcome = await this.#sendMessage(tx, tenant, step, input);
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
    input: { message: string; skill: { aiAgentId: string | null } },
  ): Promise<{ text: string | null; detail: string }> {
    if (step.source === 'text') {
      return { text: step.text ?? null, detail: 'sent the fixed reply' };
    }

    const hits = await this.knowledge.retrieve(tx, tenant, input.message, {
      ...(input.skill.aiAgentId ? { aiAgentId: input.skill.aiAgentId } : {}),
      limit: 2,
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
    return {
      text: best.text,
      detail: `answered from "${best.sourceName}" (${best.score})`,
    };
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
