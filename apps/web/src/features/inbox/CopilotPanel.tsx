/**
 * Copilot — the agent-assist panel (FR-MOD-12.1 / 12.3).
 *
 * A third mode of the right-hand panel, opened per conversation from the
 * transcript header. It offers three things and decides nothing: a summary the
 * agent can drop into an internal note, a reply drafted from the copilot
 * knowledge base, and a rewrite of whatever the agent is about to send. A draft
 * never sends itself — "Insert into reply" hands it to the composer, where the
 * agent edits and sends it. Using any of these records an assist server-side, so
 * the conversation counts as "assisted" in Reports (07.3.2).
 */
import { useState, type ReactElement } from 'react';
import { EmptyState } from '../../components/EmptyState.js';
import { Skeleton } from '../../components/Skeleton.js';
import { Panel, PanelSection } from '../../components/ui/index.js';
import { formatCount, formatDate, formatRate } from '../../lib/format.js';
import { offerDraft } from './copilotDraft.js';
import {
  useCopilotBi,
  useCopilotEnhance,
  useCopilotReply,
  useCopilotSummary,
  type EnhanceMode,
} from './useCopilot.js';

const ENHANCE_MODES: Array<{ id: EnhanceMode; label: string }> = [
  { id: 'rephrase', label: 'Rephrase' },
  { id: 'friendly', label: 'Friendlier' },
  { id: 'formal', label: 'More formal' },
  { id: 'grammar', label: 'Fix grammar' },
];

/**
 * Example questions for the `not_understood` empty state (FR-EK-B.1).
 *
 * `apps/web` is deliberately decoupled from `@nexa/ai-mock` (the same split
 * `templates.test.ts` documents for skill steps), so these are not imported —
 * each phrase is copied verbatim from a `BI_METRICS` entry in
 * `packages/ai-mock/src/bi-intent.ts`, so clicking one is guaranteed to
 * resolve to a real metric rather than a guess. Keep in sync by hand if that
 * dictionary changes.
 */
const BI_EXAMPLE_QUESTIONS: readonly string[] = [
  'How many chats started this week?',
  'How many chats closed this week?',
  'How many chats were resolved automatically today?',
  "What's the customer satisfaction score this month?",
];

/**
 * One canonical phrase per Overview field a `metric`/`no_data` answer can
 * name — the same source as {@link BI_EXAMPLE_QUESTIONS} — for the `no_data`
 * "try a wider window" suggestion.
 */
const BI_METRIC_PHRASE: Record<string, string> = {
  'totals.chats': 'how many chats started',
  'totals.closed': 'how many chats closed',
  'totals.manual': 'how many chats resolved manually',
  'totals.assisted': 'how many chats assisted',
  'totals.automated': 'how many chats resolved automatically',
  'satisfaction.score': 'customer satisfaction score',
};

/**
 * A fresh 30-day question for `metric` — never the original question text, so
 * a narrower window it may have named cannot linger in the new one.
 */
function widenedBiQuestion(metric: string): string | null {
  const phrase = BI_METRIC_PHRASE[metric];
  if (!phrase) return null;
  return `${phrase[0]!.toUpperCase()}${phrase.slice(1)} in the last 30 days?`;
}

export function CopilotPanel({
  chatId,
  chatActive,
  onShowDetails,
  onCollapse,
}: {
  chatId: string;
  chatActive: boolean;
  /** Switch the panel back to the Details tab. */
  onShowDetails: () => void;
  /** Hide the panel entirely (Expand mode). */
  onCollapse?: () => void;
}): ReactElement {
  const summary = useCopilotSummary(chatId);
  const reply = useCopilotReply(chatId);
  const enhance = useCopilotEnhance(chatId);
  const bi = useCopilotBi();
  const [draftText, setDraftText] = useState('');
  const [biQuestion, setBiQuestion] = useState('');

  return (
    <Panel
      label="Copilot"
      title={
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true">✧</span> Copilot
        </span>
      }
      className="w-details shrink-0 overflow-y-auto border-l border-border"
      onCollapse={onCollapse}
      collapseLabel="Collapse Copilot panel"
      headerAction={
        <button
          type="button"
          onClick={onShowDetails}
          className="rounded-md border border-border px-2 py-0.5 text-2xs font-medium text-content-secondary hover:bg-surface-2"
        >
          Details
        </button>
      }
    >
      {!chatActive && (
        <p className="border-b border-border px-4 py-3 text-xs text-content-tertiary">
          Reopen the conversation to use Copilot.
        </p>
      )}

      {/* Summary → internal note (12.3 / 02.5) */}
      <PanelSection title="Summary">
        <p className="text-xs text-content-secondary">
          Summarise this conversation and post it as an internal note for your team.
        </p>
        <button
          type="button"
          onClick={() => summary.mutate()}
          disabled={!chatActive || summary.isPending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {summary.isPending ? 'Summarising…' : 'Summarise conversation'}
        </button>
        {summary.isError && (
          <p role="alert" className="text-2xs text-danger">
            Could not summarise — try again.
          </p>
        )}
        {summary.data && (
          <div className="rounded-md bg-inset p-2 text-xs">
            <p className="text-content-secondary">{summary.data.summary}</p>
            <p className="mt-1 text-2xs text-success">Added as an internal note.</p>
          </div>
        )}
      </PanelSection>

      {/* Reply draft from the copilot knowledge base (12.3) */}
      <PanelSection title="Suggested reply">
        <p className="text-xs text-content-secondary">
          Draft a reply from the copilot knowledge base.
        </p>
        <button
          type="button"
          onClick={() => reply.mutate()}
          disabled={!chatActive || reply.isPending}
          className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {reply.isPending ? 'Drafting…' : 'Draft a reply'}
        </button>
        {reply.isError && (
          <p role="alert" className="text-2xs text-danger">
            Could not draft a reply — try again.
          </p>
        )}
        {reply.data &&
          (reply.data.draft ? (
            <div className="flex flex-col gap-2 rounded-md bg-inset p-2 text-xs">
              <p className="text-content-secondary">{reply.data.draft}</p>
              <InsertButton chatId={chatId} text={reply.data.draft} />
              {reply.data.sources.length > 0 && (
                <p className="text-2xs text-content-tertiary">
                  From: {reply.data.sources.map((s) => s.name).join(', ')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-2xs text-content-tertiary">
              No suggestion found in the copilot knowledge base.
            </p>
          ))}
      </PanelSection>

      {/* Enhance / rephrase the agent's own draft (12.3) */}
      <PanelSection title="Improve a draft">
        <label className="sr-only" htmlFor="copilot-enhance-input">
          Draft to improve
        </label>
        <textarea
          id="copilot-enhance-input"
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          rows={3}
          maxLength={10_000}
          placeholder="Paste or write a draft, then pick a tone…"
          className="w-full resize-none rounded-md border border-border bg-inset px-2 py-1.5 text-xs outline-none placeholder:text-content-tertiary"
        />
        <div className="flex flex-wrap gap-1">
          {ENHANCE_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => enhance.mutate({ text: draftText, mode: mode.id })}
              disabled={!chatActive || !draftText.trim() || enhance.isPending}
              className="rounded-sm border border-border px-2 py-1 text-2xs hover:bg-surface-2 disabled:opacity-50"
            >
              {mode.label}
            </button>
          ))}
        </div>
        {enhance.isError && (
          <p role="alert" className="text-2xs text-danger">
            Could not rewrite that — try again.
          </p>
        )}
        {enhance.data && (
          <div className="flex flex-col gap-2 rounded-md bg-inset p-2 text-xs">
            <p className="text-content-secondary">{enhance.data.text}</p>
            <InsertButton chatId={chatId} text={enhance.data.text} />
          </div>
        )}
      </PanelSection>

      {/* BI command — a report/metric question about the workspace (12.4) */}
      <PanelSection title="Ask about your reports">
        <p className="text-xs text-content-secondary">
          Ask a report question about this workspace, e.g. how many chats closed this week.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const question = biQuestion.trim();
            if (question) bi.mutate(question);
          }}
          className="flex gap-1.5"
        >
          <label className="sr-only" htmlFor="copilot-bi-question">
            Ask about your reports
          </label>
          <input
            id="copilot-bi-question"
            type="text"
            value={biQuestion}
            onChange={(event) => setBiQuestion(event.target.value)}
            maxLength={500}
            placeholder="How many chats closed this week?"
            className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-xs outline-none placeholder:text-content-tertiary"
          />
          <button
            type="submit"
            disabled={!biQuestion.trim() || bi.isPending}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            {bi.isPending ? 'Asking…' : 'Ask'}
          </button>
        </form>
        <BiAnswerCard bi={bi} onExampleClick={setBiQuestion} />
      </PanelSection>
    </Panel>
  );
}

/** Hands a suggestion to the composer (FR-MOD-12.3). */
function InsertButton({ chatId, text }: { chatId: string; text: string }): ReactElement {
  return (
    <button
      type="button"
      onClick={() => offerDraft(chatId, text)}
      className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white hover:bg-brand-600"
    >
      Insert into reply
    </button>
  );
}

/**
 * The BI answer, in place of the row it replaced — loading, then whatever
 * `kind` came back (12.4-bi-d/-e). Only `metric` gets the full card: `value`,
 * the report field it quotes, the window it covers, and — the source
 * transparency this task exists for — where the number came from, so an agent
 * never has to take Copilot's word for it. `no_data` and `not_understood`
 * both render through `EmptyState` (FR-EK-B.1), the same component the
 * palette's `AiAnswerCard` uses for its identical two negative kinds — a
 * question Copilot never learned and a window with nothing in it are both
 * "nothing found here", and a bare empty rectangle is exactly what that
 * component exists to replace. Their `description` comes straight from
 * `answer` rather than a second, hand-written string, so the two copies can
 * never drift.
 */
function BiAnswerCard({
  bi,
  onExampleClick,
}: {
  bi: ReturnType<typeof useCopilotBi>;
  /** Fills the question input with a suggestion — it never asks it outright, so the agent can review or edit first. */
  onExampleClick: (question: string) => void;
}): ReactElement | null {
  if (bi.isPending) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2 rounded-md bg-inset p-2">
        <Skeleton width="55%" />
        <Skeleton width="90%" />
        <Skeleton width="35%" />
      </div>
    );
  }

  if (bi.isError) {
    return (
      <p role="alert" className="text-2xs text-danger">
        Could not get an answer — try again.
      </p>
    );
  }

  if (!bi.data) return null;
  const { answer, kind, metric, value, range } = bi.data;

  if (kind === 'not_understood') {
    return (
      <EmptyState
        title="Not sure what you mean"
        description={answer}
        action={
          <div className="flex w-full flex-col gap-1">
            {BI_EXAMPLE_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => onExampleClick(question)}
                className="rounded-md border border-border px-2.5 py-1.5 text-left text-2xs text-content-secondary hover:bg-surface-2"
              >
                {question}
              </button>
            ))}
          </div>
        }
      />
    );
  }

  if (kind === 'no_data') {
    const widened = metric ? widenedBiQuestion(metric) : null;
    return (
      <EmptyState
        title="No data for this window"
        description={answer}
        action={
          widened ? (
            <button
              type="button"
              onClick={() => onExampleClick(widened)}
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-left text-2xs text-content-secondary hover:bg-surface-2"
            >
              {widened}
            </button>
          ) : undefined
        }
      />
    );
  }

  if (value === null || range === null) {
    // `kind === 'metric'` but the contract's null pairing was not honoured —
    // fall back to the plain sentence rather than a broken card.
    return <p className="text-2xs text-content-tertiary">{answer}</p>;
  }

  return (
    <div className="flex flex-col gap-1 rounded-md bg-inset p-2 text-xs">
      <p className="text-content-secondary">{answer}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold">
          {metric === 'satisfaction.score' ? formatRate(value) : formatCount(value)}
        </span>
        {metric && (
          <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-2xs text-content-tertiary">
            {metric}
          </span>
        )}
      </div>
      <p className="text-2xs text-content-tertiary">
        {formatDate(range.from)} – {formatDate(range.to)}
      </p>
      <p className="text-2xs text-content-tertiary">Source: Reports → Overview</p>
    </div>
  );
}
