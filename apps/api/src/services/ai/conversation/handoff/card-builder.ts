/**
 * The hand-over card, built (tm 304.1 · SiyahTuş analysis AI-10 §1–§3, §6).
 *
 * Pure: what the turn left behind — the conversation's state, its decisions,
 * the hand-over's reasons — and what the writer read for it (the player, the
 * AI's last messages, the files) in; the card and its plain text out. No model
 * writes any of it: the subject is the procedure's name, the slots are the
 * procedure's `show_in_card` ones in its order, the decision's basis is its
 * `handoff.card_fields` filled, the suggested step its `next_step_hint`.
 *
 * What the card never carries: a `pii: 'high'` slot's value (its line says it
 * was given, nothing more — AI-04 §9), and anything an internal note said —
 * the writer reads the AI's own messages and the player's files, nothing else.
 *
 * The one-line summary (`threads.summary` too, AI-10 §4): the procedure's
 * name and what was collected; without a procedure "Soru: <the player's first
 * message>" — the LLM summary of AI-10 §2 is off by default and not built.
 *
 * Also here: the line the player is told with the hand-over (AI-10-S1) — the
 * values they gave themselves, so a wrongly read one can be corrected.
 */
import {
  AI_HANDOFF_CARD_TEXT_MAX,
  AI_HANDOFF_OUTPUT_FLAGS,
  AI_HANDOFF_STATEMENTS_MAX,
  AI_HANDOFF_SUMMARY_MAX,
  type AiHandoffAttachment,
  type AiHandoffFact,
  type AiHandoffOutputFlag,
  type AiHandoffPlayer,
  type AiHandoffSentiment,
  type AiHandoffSlotLine,
  type AiHandoffStatement,
  type GuardrailHitAction,
  type GuardrailPriority,
  type HandoffReason,
  type IdentityTrust,
  type PersonaLanguage,
} from '@siyahtus/types';
import { NO_FACTS, type ProcedureFacts } from '../procedure/conditions.js';
import { readSnapshot, type ProcedureSnapshot } from '../procedure/executor.js';
import { fillTemplate, variableText, type TemplateContext } from '../procedure/templates.js';
import { slotCardLines, slotRecord } from '../slots/extract.js';
import { readRiskFlags } from '../guardrails/guardrail-turn.js';
import type { TurnDecisions, TurnState } from '../turn.js';
import { redactPlayerContact } from '../../../customers/player-contact.js';

/** What the card is built from. */
export interface HandoffCardSource {
  readonly reasonCodes: readonly HandoffReason[];
  readonly primaryReason: HandoffReason;
  readonly priority: GuardrailPriority;
  /** The team the hand-over named by id; null for routing's choice. */
  readonly targetGroupId: number | null;
  /** The conversation after the turn; null when no turn ran (today's cap). */
  readonly state: TurnState | null;
  /** The turn's decisions; null when no turn ran. */
  readonly decisions: TurnDecisions | null;
  readonly player: { username: string | null; name: string | null; email: string | null };
  /** How the visitor proved who they are (K4); `verified` is a recognised device. */
  readonly trust: IdentityTrust | null;
  /** The player's first message on the connection. */
  readonly firstMessage: string | null;
  /** What the player wrote that the hand-over answered. */
  readonly turnText: string | null;
  /**
   * The summary the turn itself wrote (a `summarize` step: "Soru: …", with the
   * same day's contact count) — kept as the card's line when no procedure ran.
   */
  readonly turnSummary?: string | null;
  /** The AI's messages on the connection, oldest first — the last five are kept. */
  readonly statements: readonly AiHandoffStatement[];
  /** The draft checks' actions on the connection's earlier turns (`ai_guardrail_hits`, output). */
  readonly earlierOutputActions: readonly GuardrailHitAction[];
  /** The conversation's and the player's active risk flags (`risk_flags`). */
  readonly storedRiskFlags: readonly string[];
  readonly attachments: readonly AiHandoffAttachment[];
  readonly now: Date;
  readonly timeZone: string;
  /** The AI-13 tables' facts for the conversation's brand (tm 310.3); none: every fact unknown. */
  readonly facts?: ProcedureFacts;
}

export interface HandoffCard {
  skillId: string | null;
  procedureKey: string | null;
  procedureSnapshotHash: string | null;
  topic: string | null;
  summary: string;
  question: string | null;
  player: AiHandoffPlayer;
  slots: AiHandoffSlotLine[];
  decisionFacts: AiHandoffFact[];
  checks: string[];
  aiStatements: AiHandoffStatement[];
  outputCheckFlags: AiHandoffOutputFlag[];
  reasonCodes: HandoffReason[];
  primaryReason: HandoffReason;
  riskFlags: string[];
  sentiment: AiHandoffSentiment | null;
  suggestedNextStep: string | null;
  attachments: AiHandoffAttachment[];
  targetGroupId: number | null;
  priority: GuardrailPriority;
  cardText: string;
  /**
   * The text of the agents-only note in the transcript: `cardText` without the
   * player's username and email, wherever it quotes them (tm 325.6). The note is one event every viewer
   * of the chat reads, and `customers.contact.view` is a per-person answer —
   * the card itself (`GET /chats/{id}/ai-handoffs`) carries them, masked per
   * viewer.
   */
  noteText: string;
}

/** The longest stretch of the player's question the summary quotes. */
const QUESTION_IN_SUMMARY = 160;
/** The longest stretch of the player's question the card keeps. */
const QUESTION_MAX = 600;
/** One AI message in the plain text, at most. */
const STATEMENT_IN_TEXT = 200;
/** How many risk flags the card lists, at most (the column's CHECK). */
const RISK_FLAGS_MAX = 20;

const SETTLED_IN_SUMMARY = new Set(['filled', 'partial', 'carried']);

const SENTIMENT_WORDS: Readonly<Record<AiHandoffSentiment, string>> = {
  positive: 'olumlu',
  neutral: 'nötr',
  negative: 'olumsuz',
  angry: 'kızgın',
};

const OUTPUT_WORDS: Readonly<Record<AiHandoffOutputFlag, string>> = {
  draft_rewritten: 'bir taslak yeniden yazıldı',
  draft_blocked: 'dikkat: bir taslak engellendi',
  draft_warned: 'bir taslak uyarı aldı',
};

/** Build the card (see the file header). */
export function buildHandoffCard(source: HandoffCardSource): HandoffCard {
  const { state, decisions } = source;
  const snapshot = state ? readSnapshot(state.procedureSnapshot) : null;
  const ctx: TemplateContext = {
    slots: state?.slots ?? {},
    facts: source.facts ?? NO_FACTS,
    now: source.now,
    timeZone: source.timeZone,
  };

  const topic = snapshot?.skill_name ?? null;
  const slots = snapshot && state ? cardSlots(snapshot, state) : [];
  const question = snapshot ? null : clip(source.turnText ?? source.firstMessage, QUESTION_MAX);
  const decisionFacts: AiHandoffFact[] = (snapshot?.procedure.handoff.card_fields ?? []).map(
    (field) => {
      const value = variableText(field, ctx);
      return { field, text: value.ok ? value.text : null };
    },
  );
  // A knowledge hand-over says why the AI had no answer (AI-06 §8).
  if (decisions?.unanswered) {
    decisionFacts.push({ field: 'knowledge', text: decisions.unanswered.reason });
  }
  const hint = snapshot?.procedure.handoff.next_step_hint;
  const filledHint = hint ? fillTemplate(hint, ctx) : null;
  const suggestedNextStep = filledHint?.ok ? filledHint.text : null;

  const player: AiHandoffPlayer = {
    username: source.player.username,
    name: source.player.name,
    email: source.player.email,
    basis: 'declared',
    recognized_device: source.trust === 'verified',
  };
  const aiStatements = source.statements.slice(-AI_HANDOFF_STATEMENTS_MAX);
  const outputCheckFlags = outputFlags([
    ...source.earlierOutputActions,
    ...(decisions?.guardrails?.hits ?? [])
      .filter((hit) => hit.stage === 'output')
      .map((hit) => hit.action),
  ]);
  const riskFlags = [
    ...new Set([
      ...(decisions?.guardrails?.risk_flags ?? []),
      ...(state ? readRiskFlags(state.signals) : []),
      ...source.storedRiskFlags,
    ]),
  ].slice(0, RISK_FLAGS_MAX);
  const checks = state ? pendingChecks(state.signals) : [];
  const summary = cardSummary(topic, slots, source.firstMessage ?? source.turnText, source);

  const card: Omit<HandoffCard, 'cardText' | 'noteText'> = {
    skillId: state?.activeSkillId ?? decisions?.skillId ?? null,
    procedureKey: decisions?.understood?.procedure_key ?? state?.activeSkillId ?? null,
    procedureSnapshotHash: state?.procedureSnapshotHash ?? null,
    topic,
    summary,
    question,
    player,
    slots,
    decisionFacts,
    checks,
    aiStatements: [...aiStatements],
    outputCheckFlags,
    reasonCodes: [...source.reasonCodes],
    primaryReason: source.primaryReason,
    riskFlags,
    sentiment: decisions?.sentiment ?? null,
    suggestedNextStep,
    attachments: [...source.attachments],
    targetGroupId: source.targetGroupId,
    priority: source.priority,
  };
  return {
    ...card,
    cardText: cardText(card),
    // Without the Oyuncu line's two values, and without them anywhere else the
    // text quotes them (the summary, the question, a slot).
    noteText: redactPlayerContact(
      cardText({ ...card, player: { ...card.player, username: null, email: null } }),
      [card.player.username, card.player.email],
      false,
    ),
  };
}

/**
 * The line the player is told with the hand-over (AI-10-S1): the values they
 * gave themselves — never a `pii: 'high'` one, never one carried from an
 * earlier connection or inferred — in the procedure's order. Null when there
 * is none, or in a language other than Turkish and English.
 */
export function playerSummaryLine(
  state: TurnState,
  language: PersonaLanguage | null,
): string | null {
  const snapshot = readSnapshot(state.procedureSnapshot);
  if (!snapshot) return null;
  const values: string[] = [];
  for (const def of snapshot.procedure.slots) {
    if (def.pii === 'high' || def.type === 'file') continue;
    const record = slotRecord(state.slots[def.name]);
    if (record.pii === 'high' || record.source !== 'player' || record.display === null) continue;
    if (record.status !== 'filled' && record.status !== 'partial') continue;
    values.push(record.display);
  }
  if (values.length === 0) return null;
  const list = values.join(', ');
  switch (language ?? 'tr') {
    case 'tr':
      return `Şu bilgileri ilettim: ${list}. Yanlış bir bilgi varsa yazabilirsiniz.`;
    case 'en':
      return `I passed on: ${list}. If anything is wrong, just write it here.`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Parts.
// ---------------------------------------------------------------------------

function cardSlots(snapshot: ProcedureSnapshot, state: TurnState): AiHandoffSlotLine[] {
  const defs = snapshot.procedure.slots;
  return slotCardLines(defs, state.slots, 'tr').map((line) => {
    const def = defs.find((candidate) => candidate.name === line.slot);
    const record = slotRecord(state.slots[line.slot]);
    const sensitive = def?.pii === 'high' || record.pii === 'high';
    return {
      slot: line.slot,
      label: line.label,
      status: line.status,
      text: sensitive ? null : line.text,
      source: record.status === 'missing' ? null : record.source,
      ...(sensitive ? { sensitive: true as const } : {}),
      ...(line.out_of_range ? { out_of_range: line.out_of_range } : {}),
    };
  });
}

function cardSummary(
  topic: string | null,
  slots: readonly AiHandoffSlotLine[],
  question: string | null,
  source: HandoffCardSource,
): string {
  if (topic !== null) {
    const values = slots
      .filter((line) => line.text !== null && SETTLED_IN_SUMMARY.has(line.status))
      .map((line) => line.text as string);
    return clip(
      values.length > 0 ? `${topic}: ${values.join(', ')}.` : `${topic}.`,
      AI_HANDOFF_SUMMARY_MAX,
    )!;
  }
  // The turn's own line says more (the day's contact count) where it wrote one.
  const own = clip(source.turnSummary, AI_HANDOFF_SUMMARY_MAX);
  if (own) return own;
  const asked = clip(question, QUESTION_IN_SUMMARY);
  return asked ? `Soru: ${asked}` : `AI devretti (${source.primaryReason}).`;
}

/** The draft checks' actions as the card's flags, in the vocabulary's order. */
function outputFlags(actions: readonly GuardrailHitAction[]): AiHandoffOutputFlag[] {
  const found = new Set<AiHandoffOutputFlag>();
  for (const action of actions) {
    if (action === 'rewrite') found.add('draft_rewritten');
    else if (action === 'safe_text' || action === 'handoff' || action === 'crisis_text') {
      found.add('draft_blocked');
    } else if (action === 'warn') found.add('draft_warned');
  }
  return AI_HANDOFF_OUTPUT_FLAGS.filter((flag) => found.has(flag));
}

/** What a tool step could not check (AI-28 `signals.pending_checks`, #321): the tools' keys. */
function pendingChecks(signals: TurnState['signals']): string[] {
  const raw = signals['pending_checks'];
  if (!Array.isArray(raw)) return [];
  const checks: string[] = [];
  for (const entry of raw) {
    const tool =
      typeof entry === 'string'
        ? entry
        : entry &&
            typeof entry === 'object' &&
            typeof (entry as { tool?: unknown }).tool === 'string'
          ? (entry as { tool: string }).tool
          : null;
    if (tool && !checks.includes(tool)) checks.push(tool);
  }
  return checks;
}

/** The card as plain text — the agents-only line and the archive (Turkish, like the research card). */
function cardText(card: Omit<HandoffCard, 'cardText' | 'noteText'>): string {
  const lines: string[] = [];
  lines.push(`Konu: ${card.topic ?? 'Prosedür dışı soru'}`);
  lines.push(`Özet: ${card.summary}`);
  const who = [
    card.player.username ? `kullanıcı adı "${card.player.username}"` : null,
    card.player.name,
    card.player.email,
  ].filter((part): part is string => Boolean(part));
  lines.push(
    `Oyuncu: ${who.length > 0 ? who.join(' · ') : 'bilinmiyor'} (oyuncu beyanı, doğrulanmadı${
      card.player.recognized_device ? '; tanınan cihaz' : ''
    })`,
  );
  if (card.slots.length > 0) {
    lines.push(
      `Toplanan bilgiler: ${card.slots
        .map(
          (line) =>
            `${line.label}: ${line.sensitive ? 'paylaşıldı (kartta gösterilmez)' : line.text}`,
        )
        .join(' | ')}`,
    );
  }
  const known = card.decisionFacts.filter((fact) => fact.text !== null);
  if (known.length > 0) {
    lines.push(`Karar dayanağı: ${known.map((fact) => `${fact.field}: ${fact.text}`).join(' | ')}`);
  }
  if (card.question) lines.push(`Soru: ${card.question}`);
  if (card.aiStatements.length > 0) {
    lines.push(
      `AI'ın söyledikleri: ${card.aiStatements
        .map((statement) => `"${clip(statement.text, STATEMENT_IN_TEXT)}"`)
        .join(' | ')}`,
    );
  }
  lines.push(
    `Çıkış denetimi: ${
      card.outputCheckFlags.length > 0
        ? card.outputCheckFlags.map((flag) => OUTPUT_WORDS[flag]).join('; ')
        : 'söz verilmedi'
    }`,
  );
  lines.push(`Devir nedeni: ${card.reasonCodes.join(' + ')} (öncelik ${card.priority})`);
  lines.push(
    `Risk/duygu: ${card.riskFlags.length > 0 ? card.riskFlags.join(', ') : 'risk bayrağı yok'}; ${
      card.sentiment ? SENTIMENT_WORDS[card.sentiment] : 'duygu okunmadı'
    }`,
  );
  if (card.attachments.length > 0) lines.push(`Ekler: ${card.attachments.length} dosya`);
  if (card.checks.length > 0) lines.push(`Kontrol edilmesi gereken: ${card.checks.join(', ')}`);
  if (card.suggestedNextStep) lines.push(`Önerilen adım: ${card.suggestedNextStep}`);
  return clip(lines.join('\n'), AI_HANDOFF_CARD_TEXT_MAX)!;
}

/** Trimmed and cut to `max` characters with an ellipsis; null for nothing. */
function clip(text: string | null | undefined, max: number): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
