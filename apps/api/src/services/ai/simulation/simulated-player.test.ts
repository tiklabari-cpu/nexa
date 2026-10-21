/**
 * The scenario's player (tm 314.6 · AI-19 §1): the scripted one, the
 * simulated one's prompt and the stub that answers it deterministically, and a
 * simulated deposit conversation played through the engine to the checks.
 */
import { describe, expect, it } from 'vitest';
import { IGAMING_TEMPLATES_TR, templateSkillFields } from '@siyahtus/ai-templates';
import {
  SCENARIO_PERSONAS,
  readPersona,
  scanGuardrails,
  type AiTestTranscriptEntry,
  type ScenarioPersona,
} from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import type { AccessInfoSource } from '../../knowledge-tables/access-info.js';
import { RETRIEVAL_THRESHOLD, type KnowledgeService } from '../knowledge-service.js';
import { ConversationEngine } from '../conversation/conversation-engine.js';
import { fixtureFacts } from '../conversation/procedure/conditions.js';
import { emptyTurnState, type TenantRunner } from '../conversation/turn.js';
import { JUDGE_MARKER } from '../conversation/guardrails/judge.js';
import { LlmProviderError } from '../provider/llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmMessage,
  LlmProvider,
} from '../provider/llm-provider.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { completeStructured } from '../provider/structured-output.js';
import { runChecks, turnEnding, type PlayedTurn } from './checks.js';
import {
  PERSONA_BEHAVIOUR,
  SIMULATED_PLAYER_MARKER,
  SIMULATED_PLAYER_OPENING,
  SIMULATED_PLAYER_RESPONSE_FORMAT,
  SIMULATED_PLAYER_RESPONSE_NAME,
  buildPlayerPrompt,
  languageName,
  mockPlayer,
  personaSignal,
  readPlayerGrounding,
  type PlayerGrounding,
  type PlayerReply,
} from './player-prompt.js';
import {
  SCRIPT_UNKNOWN_MAX,
  SIMULATED_PLAYER_MAX_OUTPUT_TOKENS,
  SimulatedPlayer,
  playerFor,
  scriptedPlayer,
  type PlayerScenario,
  type SimulatedPlayerDeps,
} from './simulated-player.js';

const TENANT = { licenseId: 1n, organizationId: 'org-test' };

const DEPOSIT_FACTS = {
  yontem: 'Papara',
  islem_zamani: '12:00',
  talep_olusturuldu: true,
  gosterilen_hesap: true,
  gonderen_kendisi: true,
  tutar: '2500 TL',
  kullanici_adi: 'ahmet77',
  referans: 'PPR12345',
};

function grounding(overrides: Partial<PlayerGrounding> = {}): PlayerGrounding {
  return {
    persona: 'normal',
    language: 'tr',
    goal: 'Papara ile yatırım yaptım, bakiyem gelmedi.',
    facts: DEPOSIT_FACTS,
    ...overrides,
  };
}

/** The request's messages for a conversation: the AI's lines and the player's, in order. */
function conversation(...lines: Array<['ai' | 'player', string]>): LlmMessage[] {
  return buildPlayerPrompt(
    grounding(),
    lines.map(([role, text]) => ({ role, text })),
  ).messages;
}

function entry(role: 'player' | 'ai', text: string, asked?: boolean): AiTestTranscriptEntry {
  return {
    role,
    text,
    at: '2026-10-18T13:50:00+03:00',
    ...(asked === undefined
      ? {}
      : {
          trace: {
            decision: asked ? 'asked' : 'answered',
            procedure: null,
            slots: {},
            sources: [],
            guardrails: [],
            handoff: null,
            flags: [],
            tokens: 0,
          },
        }),
  };
}

function scenario(overrides: Partial<PlayerScenario> = {}): PlayerScenario {
  return {
    mode: 'scripted',
    persona: 'normal',
    language: 'tr',
    turns: ['param yatmadı', 'Papara 13:40'],
    goal: null,
    facts: {},
    ...overrides,
  };
}

/** A provider that answers every call with `reply` and keeps the requests. */
function scripted(reply: (request: LlmCompletionRequest) => Promise<LlmCompletion>): LlmProvider & {
  requests: LlmCompletionRequest[];
} {
  const requests: LlmCompletionRequest[] = [];
  return {
    id: 'openai',
    requests,
    complete: (request) => {
      requests.push(request);
      return reply(request);
    },
  };
}

function deps(llm: LlmProvider, overrides: Partial<SimulatedPlayerDeps> = {}): SimulatedPlayerDeps {
  return {
    llm,
    tenant: TENANT,
    configVersionId: null,
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    ...overrides,
  };
}

const ASK_TIME = 'İşlemi saat kaçta yaptınız?';

describe('the personas', () => {
  it('every persona has its behaviour for the model', () => {
    expect(Object.keys(PERSONA_BEHAVIOUR).sort()).toEqual([...SCENARIO_PERSONAS].sort());
    for (const persona of SCENARIO_PERSONAS)
      expect(PERSONA_BEHAVIOUR[persona].length).toBeGreaterThan(20);
  });

  it("the stub's signals are worded so the platform reads them (G5's age, G2's lost money)", () => {
    const rules = (persona: ScenarioPersona, language: string) =>
      scanGuardrails(personaSignal(persona, language)!, 'input').map((match) => match.rule);
    expect(rules('resit_olmayan', 'tr')).toContain('G5');
    expect(rules('resit_olmayan', 'en')).toContain('G5');
    expect(rules('sorumlu_oyun_sinyali', 'tr')).toContain('G2');
    expect(rules('sorumlu_oyun_sinyali', 'en')).toContain('G2');
    for (const persona of ['normal', 'eksik_bilgi', 'yabanci_dil'] as const) {
      expect(personaSignal(persona, 'tr')).toBeNull();
    }
  });
});

describe('the prompt', () => {
  it("says the goal, the persona, the facts in the player's language and the rules; the context is the last line", () => {
    const prompt = buildPlayerPrompt(grounding({ persona: 'kizgin' }), [
      { role: 'player', text: 'param yatmadı' },
      { role: 'ai', text: ASK_TIME },
    ]);
    expect(prompt.system).toContain('What you want: Papara ile yatırım yaptım, bakiyem gelmedi.');
    expect(prompt.system).toContain(`How you behave: ${PERSONA_BEHAVIOUR.kizgin}`);
    expect(prompt.system).toContain('- talep_olusturuldu: Evet');
    expect(prompt.system).toContain('- tutar: 2500 TL');
    expect(prompt.system).toContain('Write only in Turkish.');
    expect(prompt.system).toContain('Never write a password, a code, a full card number or a CVV');
    const lines = prompt.system.split('\n');
    expect(lines[lines.length - 2]).toBe(SIMULATED_PLAYER_MARKER);
    // The model is the player: the assistant's lines are the user's turn.
    expect(prompt.messages).toEqual([
      { role: 'user', content: SIMULATED_PLAYER_OPENING },
      { role: 'assistant', content: 'param yatmadı' },
      { role: 'user', content: ASK_TIME },
    ]);
  });

  it('reads its context back, and nothing from another prompt', () => {
    const g = grounding({ persona: 'yabanci_dil', language: 'de', facts: { betrag: 50 } });
    expect(readPlayerGrounding(buildPlayerPrompt(g, []).system)).toEqual(g);
    expect(
      readPlayerGrounding(`${JUDGE_MARKER}\n{"message":"x","draft":"y","rules":[]}`),
    ).toBeNull();
    expect(
      readPlayerGrounding(
        `${SIMULATED_PLAYER_MARKER}\n{"persona":"robot","language":"tr","goal":"","facts":{}}`,
      ),
    ).toBeNull();
    expect(
      readPlayerGrounding(
        `${SIMULATED_PLAYER_MARKER}\n{"persona":"normal","language":"tr","goal":"","facts":{"a":[1]}}`,
      ),
    ).toBeNull();
    expect(readPlayerGrounding(`${SIMULATED_PLAYER_MARKER}\nnot json`)).toBeNull();
  });

  it('names the language in English for the model', () => {
    expect(languageName('tr')).toBe('Turkish');
    expect(languageName('ru')).toBe('Russian');
    expect(languageName('not a code')).toBe('not a code');
  });
});

describe('the stub player', () => {
  it('opens with the goal, the persona signal after it', () => {
    const opening = buildPlayerPrompt(grounding(), []).messages;
    expect(mockPlayer(grounding(), opening).message).toBe(
      'Papara ile yatırım yaptım, bakiyem gelmedi.',
    );
    expect(mockPlayer(grounding({ persona: 'resit_olmayan' }), opening).message).toBe(
      'Papara ile yatırım yaptım, bakiyem gelmedi. 16 yaşındayım.',
    );
    expect(
      mockPlayer(
        grounding({ persona: 'insan_istiyor', language: 'en', goal: 'My deposit is missing.' }),
        opening,
      ).message,
    ).toBe('My deposit is missing. I want to talk to a human agent.');
  });

  it('answers a question with the fact it names, by word stems', () => {
    const asked = (question: string) =>
      mockPlayer(grounding(), conversation(['player', 'yatırım yaptım'], ['ai', question])).message;
    expect(asked(ASK_TIME)).toBe('12:00');
    expect(asked('Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu?')).toBe('Evet');
    expect(asked('Gönderim kendi adınıza kayıtlı bir hesaptan mı yapıldı?')).toBe('Evet');
    expect(asked('Sitedeki kullanıcı adınızı ya da üye numaranızı yazar mısınız?')).toBe('ahmet77');
  });

  it('answers every question of one message in one line, a repeated answer once', () => {
    const asked = (question: string) =>
      mockPlayer(grounding(), conversation(['player', 'yatırım yaptım'], ['ai', question])).message;
    expect(
      asked(`Birkaç bilgiye ihtiyacım var.\nHangi yöntemle yatırım yaptınız? ${ASK_TIME}`),
    ).toBe('Papara, 12:00');
    expect(
      asked(
        'Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu? Gönderimi size o talepte gösterilen hesap bilgisine mi yaptınız?',
      ),
    ).toBe('Evet');
  });

  it('breaks a tie towards a fact not given yet, and gives a named one again when asked again', () => {
    const tie = 'İşlemin referans ya da işlem numarasını paylaşır mısınız?';
    expect(
      mockPlayer(
        grounding(),
        conversation(
          ['player', 'yatırım yaptım'],
          ['ai', ASK_TIME],
          ['player', '12:00'],
          ['ai', tie],
        ),
      ).message,
    ).toBe('PPR12345');
    expect(
      mockPlayer(
        grounding(),
        conversation(
          ['player', 'yatırım yaptım'],
          ['ai', ASK_TIME],
          ['player', '12:00'],
          ['ai', ASK_TIME],
        ),
      ).message,
    ).toBe('12:00');
  });

  it('to a question naming nothing, the next fact it has not given — skipping one it already wrote', () => {
    const g = grounding({ facts: { yontem: 'Papara', tutar: '2500 TL' } });
    const messages = buildPlayerPrompt(g, [
      { role: 'player', text: 'Papara ile yatırdım' },
      { role: 'ai', text: 'Ne kadar yatırdınız?' },
    ]).messages;
    expect(mockPlayer(g, messages).message).toBe('2500 TL');
    const none = buildPlayerPrompt(g, [
      { role: 'player', text: 'Papara ile yatırdım' },
      { role: 'ai', text: 'Ne kadar yatırdınız?' },
      { role: 'player', text: '2500 TL' },
      { role: 'ai', text: 'Dekontu ekleyebilir misiniz?' },
    ]).messages;
    expect(mockPlayer(g, none).message).toBe('Bilmiyorum.');
    expect(mockPlayer({ ...g, language: 'en' }, none).message).toBe("I don't know.");
  });

  it('says yes to "is it solved?", and nothing to a statement or after its own line', () => {
    expect(
      mockPlayer(
        grounding(),
        conversation(['player', 'x'], ['ai', 'Bu bilgiler işinize yaradı mı?']),
      ).message,
    ).toBe('Evet, teşekkürler.');
    expect(
      mockPlayer(
        grounding(),
        conversation(['player', 'x'], ['ai', 'Talebinizi finans ekibine ilettim.']),
      ).message,
    ).toBeNull();
    expect(mockPlayer(grounding(), conversation(['player', 'x'])).message).toBeNull();
  });

  it('eksik_bilgi stalls the first time a fact is asked for and gives it the second', () => {
    const g = grounding({ persona: 'eksik_bilgi' });
    const first = conversation(['player', 'yatırım yaptım'], ['ai', ASK_TIME]);
    expect(mockPlayer(g, first).message).toBe('Bir saniye, bakıyorum.');
    const second = conversation(
      ['player', 'yatırım yaptım'],
      ['ai', ASK_TIME],
      ['player', 'Bir saniye, bakıyorum.'],
      ['ai', ASK_TIME],
    );
    expect(mockPlayer(g, second).message).toBe('12:00');
  });

  it('answers through the mock provider, which refuses a player request with no context', async () => {
    const llm = new MockLlmProvider();
    const prompt = buildPlayerPrompt(grounding(), [
      { role: 'player', text: 'yatırım yaptım' },
      { role: 'ai', text: ASK_TIME },
    ]);
    const { value, usage } = await completeStructured<PlayerReply>(llm, {
      ...prompt,
      maxOutputTokens: 300,
      timeoutMs: 20_000,
      tier: 'fast',
      responseFormat: SIMULATED_PLAYER_RESPONSE_FORMAT,
    });
    expect(value).toEqual({ message: '12:00' });
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    await expect(
      llm.complete({
        system: 'no context',
        messages: [],
        maxOutputTokens: 300,
        timeoutMs: 20_000,
        responseFormat: SIMULATED_PLAYER_RESPONSE_FORMAT,
      }),
    ).rejects.toThrow(/buildPlayerPrompt/);
  });
});

describe('the scripted player', () => {
  it("plays the script in order, each line masked as a visitor's message (AI-26)", async () => {
    const player = scriptedPlayer(
      scenario({ turns: ['param yatmadı', 'kartım 4111 1111 1111 1111 ile yatırdım'] }),
    );
    expect(await player.next([])).toEqual({
      text: 'param yatmadı',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const second = await player.next([
      entry('player', 'param yatmadı'),
      entry('ai', ASK_TIME, true),
    ]);
    expect(second.text).toContain('**** **** **** 1111');
    expect(second.text).not.toContain('4111 1111');
  });

  it(`past its script it does not know, ${SCRIPT_UNKNOWN_MAX} times at most, and only when asked`, async () => {
    const player = scriptedPlayer(scenario({ turns: ['param yatmadı'] }));
    const asked = [entry('player', 'param yatmadı'), entry('ai', ASK_TIME, true)];
    expect((await player.next(asked)).text).toBe('Bilmiyorum.');
    const again = [...asked, entry('player', 'Bilmiyorum.'), entry('ai', ASK_TIME, true)];
    expect((await player.next(again)).text).toBe('Bilmiyorum.');
    const third = [...again, entry('player', 'Bilmiyorum.'), entry('ai', ASK_TIME, true)];
    expect((await player.next(third)).text).toBeNull();
    // The AI said something that is not a question: the scenario has nothing more.
    expect(
      (await player.next([entry('player', 'param yatmadı'), entry('ai', 'Bekleyiniz.', false)]))
        .text,
    ).toBeNull();
    // With no trace, the text says whether it asked.
    expect(
      (await player.next([entry('player', 'param yatmadı'), entry('ai', ASK_TIME)])).text,
    ).toBe('Bilmiyorum.');
    expect(
      (
        await scriptedPlayer(scenario({ turns: ['x'], language: 'en' })).next([
          entry('player', 'x'),
          entry('ai', 'When?', true),
        ])
      ).text,
    ).toBe("I don't know.");
  });
});

describe('the simulated player', () => {
  const simulated = (overrides: Partial<PlayerScenario> = {}) =>
    scenario({
      mode: 'simulated',
      persona: 'sabirsiz',
      turns: [],
      goal: 'Papara ile yatırım yaptım, bakiyem gelmedi.',
      facts: DEPOSIT_FACTS,
      ...overrides,
    });

  it('plays its opening lines without the model, then asks the fast model for each line', async () => {
    const llm = scripted(async () => ({
      text: JSON.stringify({ message: 'Saat 12:00 civarı, acele edin!' }),
      usage: { inputTokens: 120, outputTokens: 9 },
    }));
    const player = new SimulatedPlayer(simulated({ turns: ['param yatmadı'] }), deps(llm));
    expect(await player.next([])).toEqual({
      text: 'param yatmadı',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(llm.requests).toHaveLength(0);

    const line = await player.next([entry('player', 'param yatmadı'), entry('ai', ASK_TIME, true)]);
    expect(line).toEqual({
      text: 'Saat 12:00 civarı, acele edin!',
      usage: { inputTokens: 120, outputTokens: 9 },
    });
    const [request] = llm.requests;
    expect(request).toMatchObject({
      tier: 'fast',
      maxOutputTokens: SIMULATED_PLAYER_MAX_OUTPUT_TOKENS,
      timeoutMs: 20_000,
      responseFormat: { name: SIMULATED_PLAYER_RESPONSE_NAME },
    });
    expect(readPlayerGrounding(request!.system)).toMatchObject({
      persona: 'sabirsiz',
      language: 'tr',
    });
    expect(request!.messages.at(-1)).toEqual({ role: 'user', content: ASK_TIME });
  });

  it('masks a secret the model wrote, and ends on null or an empty line — keeping what the call cost', async () => {
    const replies = [
      { message: 'Kartım 4111 1111 1111 1111, CVV 123' },
      { message: null },
      { message: '   ' },
    ];
    const llm = scripted(async () => ({
      text: JSON.stringify(replies.shift()),
      usage: { inputTokens: 50, outputTokens: 5 },
    }));
    const player = new SimulatedPlayer(simulated(), deps(llm));
    const transcript = [entry('player', 'x'), entry('ai', ASK_TIME, true)];
    const masked = await player.next(transcript);
    expect(masked.text).not.toMatch(/4111 1111|CVV 123/);
    expect(masked.text).toContain('1111');
    expect(await player.next(transcript)).toEqual({
      text: null,
      usage: { inputTokens: 50, outputTokens: 5 },
    });
    expect((await player.next(transcript)).text).toBeNull();
  });

  it("keeps a small reply ceiling under the deployment's, and a too-long prompt is never sent", async () => {
    const llm = scripted(async () => ({
      text: '{"message":"x"}',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    await new SimulatedPlayer(simulated(), deps(llm, { maxOutputTokens: 120 })).next([]);
    expect(llm.requests[0]!.maxOutputTokens).toBe(120);
    await expect(
      new SimulatedPlayer(simulated(), deps(llm, { maxPromptChars: 100 })).next([]),
    ).rejects.toMatchObject({ kind: 'prompt_too_long' });
    expect(llm.requests).toHaveLength(1);
  });

  it("a provider's failure is thrown: the scenario could not be played", async () => {
    const llm = scripted(async () => {
      throw new LlmProviderError('timeout');
    });
    await expect(new SimulatedPlayer(simulated(), deps(llm)).next([])).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('playerFor picks the script or the model by mode', async () => {
    const llm = scripted(async () => ({
      text: '{"message":"merhaba"}',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    expect((await playerFor(scenario(), deps(llm)).next([])).text).toBe('param yatmadı');
    expect((await playerFor(simulated(), deps(llm)).next([])).text).toBe('merhaba');
  });
});

// ---------------------------------------------------------------------------
// A simulated conversation through the engine.
// ---------------------------------------------------------------------------

const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

const knowledge = {
  threshold: RETRIEVAL_THRESHOLD,
  embedQuery: async (query: string) => ({ space: query, vector: '[1]', usage: { inputTokens: 1 } }),
  search: async () => ({ strategy: 'exact', chunksInScope: 0, chunks: [] }),
} as unknown as KnowledgeService;

const noAccess: AccessInfoSource = {
  resolve: async () => ({ kind: 'none', sourceType: null, reason: 'no_setting' }),
};

describe('a simulated deposit conversation through the engine (mock model)', () => {
  it('the stub player gives what the procedure asks, the AI hands over to finance, the checks pass', async () => {
    const template = IGAMING_TEMPLATES_TR.find((one) => one.key === 'deposit_not_credited')!;
    const seed = template.scenarios.find((one) => one.key === 'sure_asildi_finans')!;
    const skill = {
      id: '0b6c7a8e-1f2d-4c3b-9a4e-5d6f7a8b9c0d',
      name: template.name,
      aiAgentId: 'agent-1',
      steps: [],
      persona: readPersona({ tone: null, languages: [], persona: null }),
      mode: 'procedure' as const,
      definition: templateSkillFields(template),
    };
    const llm = new MockLlmProvider();
    const engine = new ConversationEngine({
      llm,
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      maxPromptChars: 16_000,
      knowledge,
      access: noAccess,
    });
    const player = new SimulatedPlayer(
      {
        mode: 'simulated',
        persona: 'normal',
        language: 'tr',
        turns: [],
        goal: 'Papara ile yatırım yaptım, bakiyem gelmedi.',
        facts: DEPOSIT_FACTS,
      },
      deps(llm),
    );
    const facts = fixtureFacts({
      facts: seed.facts,
      withinWorkingHours: () => true,
      nextWindow: () => null,
    });
    const options = { yontem: (seed.options?.['yontem'] ?? []).map((row) => ({ ...row })) };

    const transcript: AiTestTranscriptEntry[] = [];
    const turns: PlayedTurn[] = [];
    let state = emptyTurnState();
    let stop: 'handoff' | 'resolved' | 'script_end' | 'max_turns' = 'max_turns';
    for (let index = 0; index < 12; index += 1) {
      const line = await player.next(transcript);
      if (line.text === null) {
        stop = 'script_end';
        break;
      }
      const at = new Date(Date.parse('2026-10-18T13:50:00+03:00') + index * 30_000).toISOString();
      transcript.push({ role: 'player', text: line.text, at });
      const result = await engine.runTurn(
        state,
        { text: line.text },
        {
          tenant: TENANT,
          db,
          now: new Date(at),
          mode: 'simulation',
          chatId: null,
          configVersionId: null,
          config: { skills: [skill] },
          toolStubs: {},
          timeZone: 'Europe/Istanbul',
          aiMode: 'ai',
          procedure: { facts, options },
        },
      );
      turns.push({ message: line.text, result });
      state = result.nextState;
      if (result.reply) transcript.push({ role: 'ai', text: result.reply, at });
      const ending = turnEnding(result);
      if (ending) {
        stop = ending === 'handoff' ? 'handoff' : 'resolved';
        break;
      }
    }

    const checks = runChecks(
      {
        language: 'tr',
        expectations: {
          outcome: 'handoff',
          topic: 'finance',
          reason_code: 'expected_time_exceeded',
          required_slots: [
            'yontem',
            'islem_zamani',
            'talep_olusturuldu',
            'gosterilen_hesap',
            'gonderen_kendisi',
            'tutar',
            'kullanici_adi',
            'referans',
          ],
          values: {
            yontem: 'Papara',
            tutar: '2.500 TRY',
            kullanici_adi: 'ahmet77',
            referans: 'PPR12345',
          },
          max_turns: 12,
        },
      },
      { turns, stop },
      { aiAgentId: 'agent-1' },
    );
    expect(
      checks.filter((one) => !one.passed),
      transcript.map((line) => `${line.role}: ${line.text}`).join('\n'),
    ).toEqual([]);
    expect(stop).toBe('handoff');
  });
});
