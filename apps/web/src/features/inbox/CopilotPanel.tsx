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
import { Panel, PanelSection } from '../../components/ui/index.js';
import { offerDraft } from './copilotDraft.js';
import {
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
  const [draftText, setDraftText] = useState('');

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
