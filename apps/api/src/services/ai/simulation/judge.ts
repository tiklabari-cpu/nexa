/**
 * The scenario judge (tm 314.3 · SiyahTuş analysis AI-19 §4, AI-19-S3): after
 * a scenario is played, the fast model reads the conversation and scores it
 * on the platform's QA rubric (AI-24 a–g, `AI_TEST_JUDGE_CRITERIA`) — a score
 * 1–5 and a comment.
 *
 * **Advice, never a verdict.** The hard checks (`checks.ts`) decided the
 * result before the judge is asked, and nothing the judge says is read back
 * into it: a 1 does not fail a passing scenario, a 5 does not pass a failing
 * one ("LLM hakem … tek başına bir senaryoyu kaldıramasın"). The judge is told
 * which hard checks failed so its comment can say why, not to decide.
 *
 * **On the test meter.** One structured call, `fast` tier, `surface:
 * simulation` — counted on `llm_test` (AI-19-S2), inside the simulation
 * context like the turns it judges. A spent test allowance leaves the result
 * without advice and says so (`capped`): the worker stops the run, as it does
 * for a turn the allowance refused.
 *
 * **Nothing to judge, no call.** An errored scenario (stopped by a provider
 * error, the time limit, the allowance) or one where the AI never answered has
 * no conversation to score. A model that fails, times out or answers outside
 * the schema leaves the advice empty (`judge: null`) — the result stands.
 *
 * Like the other structured calls the context is one JSON line after a marker
 * at the end of the instructions; the in-process stub reads it there
 * (`mockScenarioJudge`) and scores from the failed hard checks, so the advice
 * is deterministic in every suite and in CI.
 */
import type { AiTestJudgeVerdict } from '@siyahtus/types';
import { runInSimulation } from '../../../lib/simulation-context.js';
import type { TenantContext } from '../../../lib/tenant.js';
import { AiDailyCapError } from '../ai-daily-budget.js';
import { MeteredLlm } from '../metered-llm.js';
import { refuseOverlongPrompt, type LlmProvider } from '../provider/llm-provider.js';
import { completeStructured } from '../provider/structured-output.js';
import {
  buildScenarioJudgePrompt,
  judgeGrounding,
  readScenarioJudgeReply,
  SCENARIO_JUDGE_MAX_OUTPUT_TOKENS,
  SCENARIO_JUDGE_RESPONSE_FORMAT,
  type ScenarioJudgeReply,
} from './judge-prompt.js';
import type { ScenarioPlay, SimulatedScenario } from './runner.js';

export interface ScenarioJudgeLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

export interface ScenarioJudgeDeps {
  /** The server's `MeteredLlm`; a bare provider counts nothing (a unit test's). */
  readonly llm: LlmProvider | MeteredLlm;
  /** `LLM_MAX_OUTPUT_TOKENS`; the call asks for at most {@link SCENARIO_JUDGE_MAX_OUTPUT_TOKENS}. */
  readonly maxOutputTokens: number;
  /** `LLM_TIMEOUT_MS`. */
  readonly timeoutMs: number;
  /** `LLM_MAX_PROMPT_CHARS`: a longer prompt is never sent — the result goes unjudged. */
  readonly maxPromptChars: number;
  readonly logger?: ScenarioJudgeLogger;
}

/** The judge's advice on one result, what it cost, and whether the test allowance refused it. */
export interface ScenarioJudgement {
  readonly verdict: AiTestJudgeVerdict | null;
  readonly tokens: number;
  readonly capped: boolean;
}

const UNJUDGED: ScenarioJudgement = Object.freeze({ verdict: null, tokens: 0, capped: false });

/** Whether a played scenario has a conversation to judge: played to an end, and the AI spoke. */
export function judgeable(play: Pick<ScenarioPlay, 'status' | 'transcript'>): boolean {
  return play.status !== 'errored' && play.transcript.some((entry) => entry.role === 'ai');
}

export class ScenarioJudge {
  readonly #deps: ScenarioJudgeDeps;

  constructor(deps: ScenarioJudgeDeps) {
    this.#deps = deps;
  }

  /** Advice on `play`. Never throws for the scenario's sake, and never touches its status. */
  async judge(
    input: {
      readonly tenant: TenantContext;
      readonly configVersionId: string | null;
      readonly scenario: SimulatedScenario;
    },
    play: ScenarioPlay,
  ): Promise<ScenarioJudgement> {
    if (!judgeable(play)) return UNJUDGED;
    const deps = this.#deps;
    const prompt = buildScenarioJudgePrompt(judgeGrounding(input.scenario, play));
    const llm = MeteredLlm.wrap(deps.llm).forTenant(input.tenant, {
      surface: 'simulation',
      chatId: null,
      configVersionId: input.configVersionId,
    });
    try {
      refuseOverlongPrompt(prompt, deps.maxPromptChars);
      const { value, usage } = await runInSimulation(
        { kind: 'test_run', licenseId: input.tenant.licenseId },
        () =>
          completeStructured<ScenarioJudgeReply>(llm, {
            ...prompt,
            maxOutputTokens: Math.min(deps.maxOutputTokens, SCENARIO_JUDGE_MAX_OUTPUT_TOKENS),
            timeoutMs: deps.timeoutMs,
            tier: 'fast',
            responseFormat: SCENARIO_JUDGE_RESPONSE_FORMAT,
          }),
      );
      return {
        verdict: readScenarioJudgeReply(value),
        tokens: usage.inputTokens + usage.outputTokens,
        capped: false,
      };
    } catch (error) {
      if (error instanceof AiDailyCapError) return { verdict: null, tokens: 0, capped: true };
      deps.logger?.warn(
        {
          err: error,
          scenario_key: input.scenario.key,
          license_id: String(input.tenant.licenseId),
        },
        'a test scenario could not be judged; its result stands without advice',
      );
      return UNJUDGED;
    }
  }
}
