/**
 * The player of a test scenario (tm 314.6 · SiyahTuş analysis AI-19 §1, §2):
 * what the runner (tm 314.2) asks for the next line after every AI turn.
 *
 *   - **Scripted** — the scenario's lines, in order. When they run out and the
 *     AI is still asking, the player says it does not know (05 § AI-19 §1,
 *     "Motor senaryoda olmayan bir şey sorarsa oyuncu 'bilmiyorum' yanıtı
 *     verir"), at most {@link SCRIPT_UNKNOWN_MAX} times; then it has nothing
 *     more to say.
 *   - **Simulated** — the scenario's opening lines, if it has any, then the
 *     fast model playing the persona with the facts and the goal
 *     (`player-prompt.ts`): one structured call per line, counted as a
 *     simulation (`llm_test`, AI-19-S2), answered by the stub in every suite.
 *
 * A line is what a live visitor's message is by the time a turn reads it:
 * masked (AI-26). Scenario text is synthetic by rule and the model is told
 * never to write a secret, but the transcript is stored and a model may.
 * `text: null` — the player has nothing more to say: the runner stops
 * (`script_end`). A model failure is the provider's error, thrown: the
 * scenario could not be played (`errored`).
 */
import {
  AI_TEST_TURN_TEXT_MAX,
  type AiTestFactValue,
  type AiTestScenarioMode,
  type AiTestTranscriptEntry,
  type ScenarioPersona,
} from '@siyahtus/types';
import { maskSensitive } from '../../../lib/sensitive-mask.js';
import type { TenantContext } from '../../../lib/tenant.js';
import { MeteredLlm } from '../metered-llm.js';
import { refuseOverlongPrompt, type LlmProvider, type LlmUsage } from '../provider/llm-provider.js';
import { completeStructured } from '../provider/structured-output.js';
import {
  buildPlayerPrompt,
  SIMULATED_PLAYER_RESPONSE_FORMAT,
  stock,
  type PlayerGrounding,
  type PlayerReply,
} from './player-prompt.js';

/** How many times a scripted player past its script says it does not know. */
export const SCRIPT_UNKNOWN_MAX = 2;

/** A player line is a chat message; the reply's ceiling, in tokens, below `LLM_MAX_OUTPUT_TOKENS`. */
export const SIMULATED_PLAYER_MAX_OUTPUT_TOKENS = 300;

const NOTHING: LlmUsage = Object.freeze({ inputTokens: 0, outputTokens: 0 });

/** The player's next line, and what writing it cost — nothing for a scripted one. */
export interface PlayerLine {
  /** Null: nothing more to say. */
  readonly text: string | null;
  readonly usage: LlmUsage;
}

export interface ScenarioPlayer {
  /** The line after `transcript` — the conversation so far, the AI's messages with their traces. */
  next(transcript: readonly AiTestTranscriptEntry[]): Promise<PlayerLine>;
}

/** A scenario as its player reads it (`ai_test_scenarios`, or a compliance-pack entry). */
export interface PlayerScenario {
  readonly mode: AiTestScenarioMode;
  readonly persona: ScenarioPersona;
  readonly language: string;
  /** Scripted: the lines. Simulated: the opening lines before the model takes over. */
  readonly turns: readonly string[];
  readonly goal: string | null;
  readonly facts: Readonly<Record<string, AiTestFactValue>>;
}

/** What a simulated player calls the model with. */
export interface SimulatedPlayerDeps {
  /** The server's `MeteredLlm`; a bare provider counts nothing (a unit test's). */
  readonly llm: LlmProvider | MeteredLlm;
  readonly tenant: TenantContext;
  /** The configuration version the run plays — the usage ledger's attribution. */
  readonly configVersionId: string | null;
  /** `LLM_MAX_OUTPUT_TOKENS`; the call asks for at most {@link SIMULATED_PLAYER_MAX_OUTPUT_TOKENS}. */
  readonly maxOutputTokens: number;
  /** `LLM_TIMEOUT_MS`. */
  readonly timeoutMs: number;
  /** `LLM_MAX_PROMPT_CHARS`: a longer prompt is never sent. */
  readonly maxPromptChars: number;
}

/** A line as a turn reads it: masked like a visitor's message (AI-26), within the turn bound. */
function asVisitorLine(text: string): string {
  return maskSensitive(text.trim(), { author: 'customer' }).text.slice(0, AI_TEST_TURN_TEXT_MAX);
}

function playerLines(transcript: readonly AiTestTranscriptEntry[]): number {
  return transcript.filter((entry) => entry.role === 'player').length;
}

/** Whether the AI's last word was a question: its trace says so, else its text. */
function lastAsked(transcript: readonly AiTestTranscriptEntry[]): boolean {
  const last = transcript[transcript.length - 1];
  if (!last || last.role !== 'ai') return false;
  return last.trace ? last.trace.decision === 'asked' : last.text.includes('?');
}

/** The scenario's own line `index`, when it has one. */
function scriptLine(scenario: PlayerScenario, index: number): PlayerLine | null {
  const line = scenario.turns[index];
  return line === undefined ? null : { text: asVisitorLine(line), usage: NOTHING };
}

export function scriptedPlayer(scenario: PlayerScenario): ScenarioPlayer {
  return {
    next: async (transcript) => {
      const played = playerLines(transcript);
      const line = scriptLine(scenario, played);
      if (line) return line;
      const past = played - scenario.turns.length;
      if (past < SCRIPT_UNKNOWN_MAX && lastAsked(transcript)) {
        return { text: stock(scenario.language).unknown, usage: NOTHING };
      }
      return { text: null, usage: NOTHING };
    },
  };
}

export class SimulatedPlayer implements ScenarioPlayer {
  readonly #scenario: PlayerScenario;
  readonly #deps: SimulatedPlayerDeps;
  readonly #grounding: PlayerGrounding;

  constructor(scenario: PlayerScenario, deps: SimulatedPlayerDeps) {
    this.#scenario = scenario;
    this.#deps = deps;
    this.#grounding = {
      persona: scenario.persona,
      language: scenario.language,
      goal: scenario.goal ?? '',
      facts: scenario.facts,
    };
  }

  async next(transcript: readonly AiTestTranscriptEntry[]): Promise<PlayerLine> {
    const opening = scriptLine(this.#scenario, playerLines(transcript));
    if (opening) return opening;

    const deps = this.#deps;
    const prompt = buildPlayerPrompt(
      this.#grounding,
      transcript.flatMap((entry) =>
        entry.role === 'system' ? [] : [{ role: entry.role, text: entry.text }],
      ),
    );
    refuseOverlongPrompt(prompt, deps.maxPromptChars);
    const llm = MeteredLlm.wrap(deps.llm).forTenant(deps.tenant, {
      surface: 'simulation',
      chatId: null,
      configVersionId: deps.configVersionId,
    });
    const { value, usage } = await completeStructured<PlayerReply>(llm, {
      ...prompt,
      maxOutputTokens: Math.min(deps.maxOutputTokens, SIMULATED_PLAYER_MAX_OUTPUT_TOKENS),
      timeoutMs: deps.timeoutMs,
      tier: 'fast',
      responseFormat: SIMULATED_PLAYER_RESPONSE_FORMAT,
    });
    const text = value.message === null ? '' : asVisitorLine(value.message);
    return { text: text === '' ? null : text, usage };
  }
}

/** The scenario's player: its script, or the model playing its persona. */
export function playerFor(scenario: PlayerScenario, deps: SimulatedPlayerDeps): ScenarioPlayer {
  return scenario.mode === 'scripted'
    ? scriptedPlayer(scenario)
    : new SimulatedPlayer(scenario, deps);
}
