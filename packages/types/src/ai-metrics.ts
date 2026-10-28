/**
 * The AI's quality metrics (tm 320.2 · SiyahTuş analysis AI-25 "Kodlama
 * mantığı"; owner decisions K9, K10): what each figure counts, how a row
 * settles 72 hours after its close, and the words the report and the panel
 * show for each — one place, for the API (`services/reports/ai-metrics.ts`),
 * the rollup (`ai_metrics_daily`) and the screens.
 *
 * Read from `ai_conversation_outcomes` ({@link ./ai-outcomes.ts}), never from
 * the billed figure: ADR-09a's AI resolution ("closed with no agent message")
 * stays the invoice's number and the report shows it beside these, labelled
 * apart (AI-25-S1).
 *
 * The denominator **N** is the connections that ended in the window and where
 * the AI wrote at least one real turn (`ai_turns ≥ 1`: a welcome alone is not
 * a turn). Three figures read every ended row instead, because the AI's turn
 * is not what they are about: a compliance hand-over on the first message
 * (no AI turn yet) is still a mandatory hand-over, its card is still judged,
 * and its player still waits for a person.
 */
import type { AI_OUTCOMES, AiOutcome, AiOutcomeQaResult } from './ai-outcomes.js';

/** Hours after a connection's end the finalize job settles it (AI-25-S3). */
export const AI_OUTCOME_FINALIZE_HOURS = 72;

/** Below this many conversations (N) a rate is shown with a "few samples" caution. */
export const AI_METRICS_MIN_SAMPLE = 20;

/**
 * The finalize job's decision for one row (pure): an `assumed_pending` row
 * becomes `false_resolved` when the member came back about the same topic
 * within 72 hours or QA found the matter unsolved, `assumed_resolved`
 * otherwise. Every other outcome stays — a player's "yes" is kept even when
 * they came back (the false-resolution rate counts that one, K9).
 */
export function finalizedOutcome(
  outcome: AiOutcome | null,
  repeatSameIntent: boolean | null,
  qaResult: AiOutcomeQaResult | null,
): AiOutcome | null {
  if (outcome !== 'assumed_pending') return outcome;
  return repeatSameIntent === true || qaResult === 'unresolved'
    ? 'false_resolved'
    : 'assumed_resolved';
}

/** The metrics, in the order the report and the screens list them. */
export const AI_METRIC_KEYS = [
  'confirmed_resolution',
  'assumed_resolution',
  'unsettled',
  'false_resolution',
  'containment',
  'handoff_rate',
  'handoff_quality',
  'reask_rate',
  'mandatory_handoff_compliance',
  'guardrail_violation',
  'guardrail_suspected',
  'bsat',
  'csat_after_handoff',
  'clarification_efficiency',
  'handoff_wait',
  'consistency',
  'repeat_unmeasured',
] as const;
export type AiMetricKey = (typeof AI_METRIC_KEYS)[number];

/** One metric's words, in the panel's two languages. */
export interface AiMetricDefinition {
  readonly label: { readonly tr: string; readonly en: string };
  /** The tooltip: what the figure counts, in one or two sentences. */
  readonly hint: { readonly tr: string; readonly en: string };
  /** The figure the workspace aims for, when it has one (a share, 0–1). */
  readonly target?: number;
}

export const AI_METRIC_DEFINITIONS: Readonly<Record<AiMetricKey, AiMetricDefinition>> = {
  confirmed_resolution: {
    label: { tr: 'Onaylı çözüm', en: 'Confirmed resolution' },
    hint: {
      tr: 'Oyuncunun "Çözüldü mü?" sorusuna Evet dediği bağlantıların, AI\'ın en az bir tur yazdığı biten bağlantılara oranı.',
      en: 'Connections where the player answered Yes to "Is it solved?", over the ended connections the AI wrote at least one turn in.',
    },
  },
  assumed_resolution: {
    label: { tr: 'Varsayılan çözüm', en: 'Assumed resolution' },
    hint: {
      tr: 'Devir ve onay olmadan kapanan, 72 saat içinde aynı konuyla geri gelinmeyen bağlantıların oranı. Yalnız kesinleşmiş satırlar sayılır.',
      en: 'Connections that closed without a hand-over or an answer and did not come back about the same topic within 72 hours. Settled rows only.',
    },
  },
  unsettled: {
    label: { tr: 'Kesinleşmemiş', en: 'Not settled yet' },
    hint: {
      tr: 'Varsayılan çözüm adayları: kapanışlarından bu yana henüz 72 saat geçmedi, tekrar temas bekleniyor.',
      en: 'Assumed-resolution candidates whose 72 hours since the close have not passed yet.',
    },
  },
  false_resolution: {
    label: { tr: 'Yanlış çözüm', en: 'False resolution' },
    hint: {
      tr: 'Onaylı ya da varsayılan çözümlerden 72 saat içinde aynı konuyla geri gelinen ya da QA\'nın "çözülmemiş" bulduğu bağlantıların oranı.',
      en: 'Of the confirmed and assumed resolutions, the share that came back about the same topic within 72 hours or that QA found unsolved.',
    },
  },
  containment: {
    label: { tr: 'Containment', en: 'Containment' },
    hint: {
      tr: 'Hiç insan mesajı yazılmayan bağlantıların oranı. Tek başına başarı göstergesi değildir: çözülmeden kapanan pencereyi de sayar.',
      en: 'Connections no person wrote in. Not a measure of success on its own: it also counts a player who gave up.',
    },
  },
  handoff_rate: {
    label: { tr: 'Devir oranı', en: 'Hand-over rate' },
    hint: {
      tr: 'Bir temsilcinin devraldığı bağlantıların oranı; neden dağılımı yanında.',
      en: 'Connections a person took over, with the reasons beside it.',
    },
  },
  handoff_quality: {
    label: { tr: 'Devir kalitesi', en: 'Hand-over quality' },
    hint: {
      tr: 'Temsilcinin devir kartını "Yeterli" bulduğu devirlerin, değerlendirilen devirlere oranı.',
      en: 'Hand-overs whose card the agent marked sufficient, over the hand-overs the agent judged.',
    },
  },
  reask_rate: {
    label: { tr: 'Tekrar sorma', en: 'Asked again' },
    hint: {
      tr: "Temsilcinin AI'ın zaten aldığı bilgiyi oyuncuya yeniden sorduğu devirlerin, değerlendirilen devirlere oranı.",
      en: 'Hand-overs where the agent asked the player again for what the AI had already collected, over the judged hand-overs.',
    },
  },
  mandatory_handoff_compliance: {
    label: { tr: 'Zorunlu devir uyumu', en: 'Mandatory hand-over compliance' },
    hint: {
      tr: 'Zorunlu bir kuralın (sorumlu oyun, reşit olmayan, kendine zarar, risk bayrağı, hesap güvenliği, şikâyet) zamanında devrettiği bağlantıların, kuralın tetiklendiği ya da QA\'nın "devredilmeliydi" dediği bağlantılara oranı. Hedef %100; her ihlal kimliğiyle listelenir.',
      en: 'Connections a mandatory rule handed over in time, over those it triggered on or QA said should have been handed over. The target is 100%; each violation is listed by id.',
    },
    target: 1,
  },
  guardrail_violation: {
    label: { tr: 'Guardrail ihlali', en: 'Guardrail violation' },
    hint: {
      tr: "QA'nın doğruladığı guardrail ihlali içeren bağlantıların oranı.",
      en: 'Connections with a guardrail violation QA confirmed.',
    },
  },
  guardrail_suspected: {
    label: { tr: 'Guardrail şüphesi', en: 'Guardrail suspicion' },
    hint: {
      tr: 'Otomatik denetimin işaretlediği bağlantıların oranı; doğrulanmış ihlal değildir.',
      en: 'Connections the automatic checks flagged; not a confirmed violation.',
    },
  },
  bsat: {
    label: { tr: 'BSAT', en: 'BSAT' },
    hint: {
      tr: "Bot memnuniyeti: yalnız AI'ın tek başına yürüttüğü (devir ve insan mesajı olmayan) bağlantılarda iyi puanların oranı.",
      en: 'Bot satisfaction: good ratings over all ratings, only on connections the AI handled alone (no hand-over, no person).',
    },
  },
  csat_after_handoff: {
    label: { tr: 'Devir sonrası CSAT', en: 'CSAT after hand-over' },
    hint: {
      tr: 'Bir temsilcinin yazdığı bağlantılarda iyi puanların oranı.',
      en: 'Good ratings over all ratings on connections a person wrote in.',
    },
  },
  clarification_efficiency: {
    label: { tr: 'Netleştirme verimliliği', en: 'Clarification efficiency' },
    hint: {
      tr: 'Zorunlu bilgileri tamamlanan bağlantılarda eksik bilgiyi istemek için sorulan ortalama tur sayısı. Düşük olan iyidir.',
      en: 'Average turns spent asking for missing required details, on connections that collected them all. Lower is better.',
    },
  },
  handoff_wait: {
    label: { tr: 'Devir sonrası bekleme', en: 'Wait after hand-over' },
    hint: {
      tr: "Devirden temsilcinin ilk mesajına geçen sürenin medyanı ve %90'lık dilimi; mesai içi ve dışı ayrı.",
      en: "Median and 90th percentile of the time from the hand-over to the first person's message, inside and outside business hours.",
    },
  },
  consistency: {
    label: { tr: 'Tutarlılık', en: 'Consistency' },
    hint: {
      tr: "Aynı konudaki bağlantı çiftlerinden AI'ın aynı sonuca (çözdü ya da devretti) vardığı çiftlerin oranı.",
      en: 'Of the pairs of connections about the same topic, the share the AI ended the same way (settled both, or handed over both).',
    },
  },
  repeat_unmeasured: {
    label: { tr: 'Tekrar temas ölçülemedi', en: 'Repeat contact not measurable' },
    hint: {
      tr: 'Oyuncu doğrulanmış bir üye kimliği taşımadığı için 72 saat tekrar teması aranamayan bağlantılar.',
      en: 'Connections whose 72-hour repeat contact cannot be searched: the player carried no verified member identity.',
    },
  },
};

/** What `GET /reports/ai-agent/breakdown?by=` groups by. */
export const AI_METRICS_BREAKDOWN_DIMENSIONS = [
  'intent',
  'reason',
  'version',
  'language',
  'brand',
  'team',
] as const;
export type AiMetricsBreakdownDimension = (typeof AI_METRICS_BREAKDOWN_DIMENSIONS)[number];

/** Which connections `GET /reports/ai-agent/conversations?metric=` lists. */
export const AI_METRICS_CONVERSATION_LISTS = [
  'confirmed_resolved',
  'assumed_resolved',
  'unsettled',
  'false_resolution',
  'handed_off',
  'abandoned',
  'declined',
  'mandatory_handoff_violation',
  'guardrail_violation',
  'guardrail_suspected',
  'repeat_unmeasured',
] as const;
export type AiMetricsConversationList = (typeof AI_METRICS_CONVERSATION_LISTS)[number];

export const AI_METRICS_CONVERSATIONS_LIMIT_DEFAULT = 50;
export const AI_METRICS_CONVERSATIONS_LIMIT_MAX = 200;

/**
 * The additive counts the rates are built from: the report sums them over raw
 * rows, the rollup keeps them per day, and the two must agree (one SQL, see
 * `services/reports/ai-metrics.ts`). {@link aiMetricCountsOf} is the same
 * definition over rows in memory — the reference the tests hold the SQL to.
 */
export interface AiMetricCounts {
  /** Every row that ended in the window. */
  ended: number;
  /** N: ended, and the AI wrote at least one turn. */
  conversations: number;
  confirmed: number;
  assumed: number;
  false_resolved: number;
  unsettled: number;
  handed_off: number;
  abandoned: number;
  declined: number;
  /** Confirmed or assumed (or already false) whose member came back about it, or QA found unsolved. */
  false_in_settled: number;
  contained: number;
  card_sufficient: number;
  card_insufficient: number;
  reasked: number;
  reask_judged: number;
  mandatory_triggered: number;
  mandatory_compliant: number;
  mandatory_violations: number;
  /** Triggered ∪ QA's "should have been handed over". */
  mandatory_due: number;
  guardrail_confirmed: number;
  guardrail_suspected: number;
  bsat_good: number;
  bsat_bad: number;
  csat_good: number;
  csat_bad: number;
  clarification_turns: number;
  clarification_rows: number;
  repeat_any: number;
  repeat_same_intent: number;
  repeat_unmeasured: number;
}

export const AI_METRIC_COUNT_KEYS = [
  'ended',
  'conversations',
  'confirmed',
  'assumed',
  'false_resolved',
  'unsettled',
  'handed_off',
  'abandoned',
  'declined',
  'false_in_settled',
  'contained',
  'card_sufficient',
  'card_insufficient',
  'reasked',
  'reask_judged',
  'mandatory_triggered',
  'mandatory_compliant',
  'mandatory_violations',
  'mandatory_due',
  'guardrail_confirmed',
  'guardrail_suspected',
  'bsat_good',
  'bsat_bad',
  'csat_good',
  'csat_bad',
  'clarification_turns',
  'clarification_rows',
  'repeat_any',
  'repeat_same_intent',
  'repeat_unmeasured',
] as const satisfies readonly (keyof AiMetricCounts)[];

export function emptyAiMetricCounts(): AiMetricCounts {
  return Object.fromEntries(
    AI_METRIC_COUNT_KEYS.map((key) => [key, 0]),
  ) as unknown as AiMetricCounts;
}

/** One outcome row as the counts read it (the columns' names). */
export interface AiMetricRow {
  readonly outcome: AiOutcome | null;
  readonly ai_turns: number;
  readonly ended: boolean;
  readonly member_key: string | null;
  readonly human_replied: boolean;
  readonly handed_over: boolean;
  readonly handoff_mandatory_rule: string | null;
  readonly mandatory_handoff_violation: boolean;
  readonly handoff_card_rating: string | null;
  readonly agent_reasked: boolean | null;
  readonly guardrail_violations_confirmed: number;
  readonly guardrail_hits: number;
  readonly bsat: string | null;
  readonly csat_after_handoff: string | null;
  readonly clarification_turns: number;
  readonly required_slots_total: number | null;
  readonly required_slots_filled: number | null;
  readonly repeat_same_intent_72h: boolean | null;
  readonly repeat_any_72h: boolean | null;
  readonly qa_result: AiOutcomeQaResult | null;
}

const SETTLED_RESOLUTIONS: readonly AiOutcome[] = [
  'confirmed_resolved',
  'assumed_resolved',
  'false_resolved',
];

/** The counts of {@link AiMetricCounts} over rows in memory (the reference definition). */
export function aiMetricCountsOf(rows: readonly AiMetricRow[]): AiMetricCounts {
  const c = emptyAiMetricCounts();
  for (const row of rows) {
    if (!row.ended) continue;
    c.ended += 1;
    // Every ended row: the card, the mandatory hand-over, the person's CSAT.
    if (row.handoff_card_rating === 'sufficient') c.card_sufficient += 1;
    if (row.handoff_card_rating === 'insufficient') c.card_insufficient += 1;
    if (row.agent_reasked !== null) c.reask_judged += 1;
    if (row.agent_reasked === true) c.reasked += 1;
    if (row.handoff_mandatory_rule !== null) c.mandatory_triggered += 1;
    if (row.mandatory_handoff_violation) c.mandatory_violations += 1;
    if (row.handoff_mandatory_rule !== null && !row.mandatory_handoff_violation) {
      c.mandatory_compliant += 1;
    }
    if (row.handoff_mandatory_rule !== null || row.mandatory_handoff_violation)
      c.mandatory_due += 1;
    if (row.csat_after_handoff === 'good') c.csat_good += 1;
    if (row.csat_after_handoff === 'bad') c.csat_bad += 1;
    if (row.ai_turns < 1) continue;
    // N.
    c.conversations += 1;
    if (row.outcome === 'confirmed_resolved') c.confirmed += 1;
    if (row.outcome === 'assumed_resolved') c.assumed += 1;
    if (row.outcome === 'false_resolved') c.false_resolved += 1;
    if (row.outcome === 'assumed_pending') c.unsettled += 1;
    if (row.outcome === 'handed_off') c.handed_off += 1;
    if (row.outcome === 'abandoned') c.abandoned += 1;
    if (row.outcome === 'declined') c.declined += 1;
    if (
      row.outcome !== null &&
      SETTLED_RESOLUTIONS.includes(row.outcome) &&
      (row.outcome === 'false_resolved' ||
        row.repeat_same_intent_72h === true ||
        row.qa_result === 'unresolved')
    ) {
      c.false_in_settled += 1;
    }
    if (!row.human_replied) c.contained += 1;
    if (row.guardrail_violations_confirmed > 0) c.guardrail_confirmed += 1;
    if (row.guardrail_hits > 0) c.guardrail_suspected += 1;
    if (!row.handed_over && !row.human_replied) {
      if (row.bsat === 'good') c.bsat_good += 1;
      if (row.bsat === 'bad') c.bsat_bad += 1;
    }
    if (
      row.required_slots_total !== null &&
      row.required_slots_total > 0 &&
      row.required_slots_filled === row.required_slots_total
    ) {
      c.clarification_rows += 1;
      c.clarification_turns += row.clarification_turns;
    }
    if (row.repeat_any_72h === true) c.repeat_any += 1;
    if (row.repeat_same_intent_72h === true) c.repeat_same_intent += 1;
    if (row.member_key === null) c.repeat_unmeasured += 1;
  }
  return c;
}

/** Adds `b` into `a` (the rollup's days into a window). */
export function addAiMetricCounts(a: AiMetricCounts, b: AiMetricCounts): AiMetricCounts {
  const sum = emptyAiMetricCounts();
  for (const key of AI_METRIC_COUNT_KEYS) sum[key] = a[key] + b[key];
  return sum;
}

/** A share, rounded to four places; null over nothing. */
export function aiMetricShare(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10_000) / 10_000;
}

/** The rates of {@link AiMetricCounts}: the `quality` block's figures. */
export interface AiQualityRates {
  conversations: number;
  low_sample: boolean;
  confirmed_resolution: number | null;
  assumed_resolution: number | null;
  unsettled: number;
  false_resolution: number | null;
  containment: number | null;
  handoff_rate: number | null;
  handoff_quality: number | null;
  reask_rate: number | null;
  mandatory_handoff_compliance: number | null;
  guardrail_violation: number | null;
  guardrail_suspected: number | null;
  bsat: number | null;
  csat_after_handoff: number | null;
  clarification_efficiency: number | null;
  repeat_unmeasured: number;
}

export function aiQualityRates(c: AiMetricCounts): AiQualityRates {
  const n = c.conversations;
  return {
    conversations: n,
    low_sample: n < AI_METRICS_MIN_SAMPLE,
    confirmed_resolution: aiMetricShare(c.confirmed, n),
    assumed_resolution: aiMetricShare(c.assumed, n),
    unsettled: c.unsettled,
    false_resolution: aiMetricShare(c.false_in_settled, c.confirmed + c.assumed + c.false_resolved),
    containment: aiMetricShare(c.contained, n),
    handoff_rate: aiMetricShare(c.handed_off, n),
    handoff_quality: aiMetricShare(c.card_sufficient, c.card_sufficient + c.card_insufficient),
    reask_rate: aiMetricShare(c.reasked, c.reask_judged),
    mandatory_handoff_compliance: aiMetricShare(c.mandatory_compliant, c.mandatory_due),
    guardrail_violation: aiMetricShare(c.guardrail_confirmed, n),
    guardrail_suspected: aiMetricShare(c.guardrail_suspected, n),
    bsat: aiMetricShare(c.bsat_good, c.bsat_good + c.bsat_bad),
    csat_after_handoff: aiMetricShare(c.csat_good, c.csat_good + c.csat_bad),
    clarification_efficiency:
      c.clarification_rows === 0
        ? null
        : Math.round((c.clarification_turns / c.clarification_rows) * 100) / 100,
    repeat_unmeasured: c.repeat_unmeasured,
  };
}

/**
 * Consistency (AI-24 pairs): within each topic, every pair of connections the
 * AI either settled both or handed over both agrees; one of each disagrees.
 * The share of agreeing pairs over all pairs; null with no pair.
 */
export function aiConsistency(
  groups: readonly { readonly settled: number; readonly handedOff: number }[],
): number | null {
  let pairs = 0;
  let agreeing = 0;
  for (const group of groups) {
    const size = group.settled + group.handedOff;
    pairs += (size * (size - 1)) / 2;
    agreeing +=
      (group.settled * (group.settled - 1)) / 2 + (group.handedOff * (group.handedOff - 1)) / 2;
  }
  return aiMetricShare(agreeing, pairs);
}

/** A wait's median and 90th percentile, in seconds (linear, like `percentile_cont`). */
export interface AiWaitSummary {
  count: number;
  median_seconds: number | null;
  p90_seconds: number | null;
}

function percentileCont(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  const lower = sorted[low] as number;
  const upper = sorted[high] as number;
  return Math.round(lower + (upper - lower) * (at - low));
}

export function aiWaitSummary(seconds: readonly number[]): AiWaitSummary {
  if (seconds.length === 0) return { count: 0, median_seconds: null, p90_seconds: null };
  const sorted = [...seconds].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median_seconds: percentileCont(sorted, 0.5),
    p90_seconds: percentileCont(sorted, 0.9),
  };
}

/** `AI_OUTCOMES` the consistency pairs count as "the AI settled it". */
export const AI_CONSISTENCY_SETTLED_OUTCOMES = [
  'confirmed_resolved',
  'assumed_pending',
  'assumed_resolved',
  'false_resolved',
] as const satisfies readonly (typeof AI_OUTCOMES)[number][];
