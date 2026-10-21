/**
 * Every ready-made template's scenarios, through the engine with the mock
 * model (tm 311.1 · AI-15 acceptance "her şablonun en az 3 senaryosu mock ile
 * geçer"). A scenario seed (`@siyahtus/ai-templates`) is a scripted
 * conversation: the player's turns at a frozen moment against one table row's
 * facts. The template is installed as the installer copies it — its skill
 * fields, its placeholders filled with their "örnek — doğrulayın" values — and
 * the conversation must end as the seed expects, with the slots it names
 * filled and no reply that carries a forbidden phrase or trips an output
 * guardrail. The AI-19 test bench (#314) runs the same seeds on a tenant's
 * own configuration.
 */
import { describe, expect, it } from 'vitest';
import {
  IGAMING_TEMPLATES_TR,
  templatePlaceholders,
  templateSkillFields,
  type AiTemplate,
  type TemplateScenario,
} from '@siyahtus/ai-templates';
import {
  compileForbiddenPhrase,
  matchForbiddenPhrases,
  readPersona,
  scanGuardrails,
  type CompiledForbiddenPhrase,
} from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import { RETRIEVAL_THRESHOLD, type KnowledgeService } from '../knowledge-service.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import { fixtureFacts } from './procedure/conditions.js';
import {
  emptyTurnState,
  type TenantRunner,
  type TurnResult,
  type TurnSkill,
  type TurnState,
} from './turn.js';

const PERSONA = readPersona({ tone: null, languages: [], persona: null });

const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

/** An empty knowledge base: a template answers from its own texts and the table's facts. */
const knowledge = {
  threshold: RETRIEVAL_THRESHOLD,
  embedQuery: async (query: string) => ({ space: query, vector: '[1]', usage: { inputTokens: 1 } }),
  search: async () => ({ strategy: 'exact', chunksInScope: 0, chunks: [] }),
} as unknown as KnowledgeService;

function engine(): ConversationEngine {
  return new ConversationEngine({
    llm: new MockLlmProvider(),
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge,
  });
}

/** `{key}` → the checklist's example value, in every text that can hold one. */
function fillPlaceholders(template: AiTemplate, text: string): string {
  let out = text;
  for (const item of template.tenant_must_fill) {
    if (item.kind === 'placeholder') out = out.split(`{${item.key}}`).join(item.example);
  }
  return out;
}

/** The template as the installer copies it, with its placeholders filled in. */
function installed(template: AiTemplate): TurnSkill {
  const fields = templateSkillFields(template);
  for (const reply of fields.procedure.templates)
    reply.text = fillPlaceholders(template, reply.text);
  const hint = fields.procedure.handoff.next_step_hint;
  if (hint !== undefined)
    fields.procedure.handoff.next_step_hint = fillPlaceholders(template, hint);
  return {
    id: template.key,
    name: template.name,
    aiAgentId: 'agent-1',
    steps: [],
    persona: PERSONA,
    mode: 'procedure',
    definition: fields,
    locked: template.locked,
  };
}

function phrases(template: AiTemplate, scenario: TemplateScenario): CompiledForbiddenPhrase[] {
  const own = template.forbidden_phrases.map((p) => compileForbiddenPhrase(p.phrase, p.match));
  const extra = (scenario.expect.forbidden_phrases ?? []).map((p) =>
    compileForbiddenPhrase(p, 'exact'),
  );
  return [...own, ...extra].filter((p): p is CompiledForbiddenPhrase => p !== null);
}

async function play(
  template: AiTemplate,
  scenario: TemplateScenario,
): Promise<{ results: TurnResult[]; state: TurnState }> {
  const ai = engine();
  const skill = installed(template);
  const facts = fixtureFacts({
    facts: scenario.facts,
    withinWorkingHours: () => scenario.within_working_hours ?? true,
    nextWindow: () => (scenario.next_window !== undefined ? new Date(scenario.next_window) : null),
  });
  const options = Object.fromEntries(
    Object.entries(scenario.options ?? {}).map(([slot, rows]) => [
      slot,
      rows.map((row) => ({ value: row.value, ...(row.aliases ? { aliases: row.aliases } : {}) })),
    ]),
  );
  let state = emptyTurnState();
  const results: TurnResult[] = [];
  for (const text of scenario.turns) {
    const result = await ai.runTurn(
      state,
      { text },
      {
        tenant: { licenseId: 1n, organizationId: 'org-test' },
        db,
        now: new Date(scenario.simulated_now),
        mode: 'live',
        chatId: 'c',
        configVersionId: null,
        config: { skills: [skill] },
        toolStubs: {},
        timeZone: 'Europe/Istanbul',
        aiMode: 'ai',
        procedure: { facts, options },
      },
    );
    results.push(result);
    state = result.nextState;
  }
  return { results, state };
}

describe.each(IGAMING_TEMPLATES_TR.map((template) => [template.key, template] as const))(
  '%s — its scenarios through the engine with the mock model (AI-15)',
  (_key, template) => {
    it('its installed copy, as the scenarios run it, has every placeholder filled', () => {
      const declared = new Set(templatePlaceholders(template));
      const body = installed(template).definition!.procedure as {
        templates: Array<{ text: string }>;
      };
      for (const reply of body.templates) {
        for (const [, name] of reply.text.matchAll(/\{([^{}]*)\}/g)) {
          expect(declared.has(name!), name).toBe(false);
        }
      }
    });

    it.each(template.scenarios.map((scenario) => [scenario.key, scenario] as const))(
      '%s',
      async (_name, scenario) => {
        const { results, state } = await play(template, scenario);
        const replies = results.map((result) => result.reply);
        const lastResult = results[results.length - 1]!;

        // Every turn answers; none says what the template or the platform forbids.
        const banned = phrases(template, scenario);
        for (const [i, reply] of replies.entries()) {
          expect(reply, `turn ${i + 1}: ${scenario.turns[i]}`).toEqual(expect.any(String));
          expect(scanGuardrails(reply!, 'output'), `turn ${i + 1}: ${reply}`).toEqual([]);
          expect(matchForbiddenPhrases(reply!, banned), `turn ${i + 1}: ${reply}`).toEqual([]);
        }

        // It ends on its last turn, not before.
        for (const [i, result] of results.slice(0, -1).entries()) {
          expect(result.decisions.outcome, `turn ${i + 1}: ${replies[i]}`).not.toBe('handed_off');
        }
        if (scenario.expect.outcome === 'handoff') {
          expect(lastResult.decisions, replies.join('\n---\n')).toMatchObject({
            outcome: 'handed_off',
            handoffReason: scenario.expect.reason_code,
          });
          expect(lastResult.sideEffects).toContainEqual(
            expect.objectContaining({
              kind: 'handoff',
              topic: scenario.expect.topic,
              reason: scenario.expect.reason_code,
            }),
          );
        } else {
          expect(lastResult.decisions.resolution, replies.join('\n---\n')).toMatchObject({
            decision: 'resolved',
            outcome: scenario.expect.outcome,
          });
        }

        for (const slot of scenario.expect.required_slots) {
          expect((state.slots[slot] as { status?: string } | undefined)?.status, slot).toBe(
            'filled',
          );
        }
        for (const [slot, value] of Object.entries(scenario.expect.values ?? {})) {
          expect((state.slots[slot] as { display?: string }).display, slot).toBe(value);
        }
      },
    );
  },
);
