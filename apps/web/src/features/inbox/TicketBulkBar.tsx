/**
 * The bar above the Tickets grid that acts on a selection (PRD §5.2 "Ticketing
 * (gelişmiş)" · FR-13-EK.3 · FR-MOD-02.7.1).
 *
 * It appears only when something is ticked, because an always-present row of
 * disabled controls above a queue is furniture. Its three jobs, in order of how
 * easy they are to get wrong:
 *
 *   1. **Say what is selected, in numbers.** "6 selected" is the only thing
 *      standing between an agent and a change they did not mean.
 *   2. **Make the action deliberate.** A picker plus an Apply button, rather
 *      than a control that fires on change: two gestures before fifty tickets
 *      move.
 *   3. **Report a partial outcome honestly.** The endpoint answers 200 when
 *      some rows were skipped, so a resolved request is not an all-clear. The
 *      summary prints both numbers and names the reason, because "4 of 6" with
 *      no explanation is worse than no summary at all. It also outlives the
 *      selection: solving a queue in `My open` takes those rows out of the view
 *      and the ticks with them, and a receipt that vanished with its own rows
 *      would leave the skipped ones unreported.
 */
import { useState, type ReactElement } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import { errorMessageKey } from '../../lib/api-client.js';
import {
  TICKET_BULK_MAX,
  ticketBulkActionFor,
  ticketBulkActionOptions,
  type TicketBulkAction,
  type TicketBulkActionOption,
} from './ticket-selection.js';
import type { TicketBulkResult } from './useTickets.js';
import type { Agent } from './types.js';

const GROUP_LABEL_KEY: Record<TicketBulkActionOption['group'], string> = {
  status: 'inbox.ticketBulk.group.status',
  priority: 'inbox.ticketBulk.group.priority',
  assignee: 'inbox.ticketBulk.group.assignee',
};

const REASON_LABEL_KEY: Record<string, string> = {
  not_found: 'inbox.ticketBulk.reason.notFound',
  merged: 'inbox.ticketBulk.reason.merged',
};

/** The one-line verdict after a request came back. */
function ResultSummary({ result }: { result: TicketBulkResult }): ReactElement {
  const t = useTranslate();
  // Reasons, counted — not one line per skipped id. A selection is at most
  // fifty rows and the agent wants to know *what kind* of thing went wrong.
  const reasons = new Map<string, number>();
  for (const row of result.results) {
    if (row.status === 'skipped' && row.reason) {
      reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    }
  }

  return (
    <p
      // Polite rather than assertive: the change is already done, and the grid
      // behind this bar is refreshing at the same moment.
      role="status"
      className={`text-xs ${result.failed > 0 ? 'text-warning' : 'text-content-secondary'}`}
    >
      {t('inbox.ticketBulk.result', { updated: result.updated, failed: result.failed })}
      {[...reasons].map(([reason, count]) => (
        <span key={reason}>
          {' · '}
          {t(REASON_LABEL_KEY[reason] ?? 'inbox.ticketBulk.reason.notFound', { count })}
        </span>
      ))}
    </p>
  );
}

export function TicketBulkBar({
  selectedCount,
  loadedCount,
  agents,
  pending,
  error,
  result,
  onApply,
  onClear,
}: {
  selectedCount: number;
  /** Rows the grid has chained so far — what the ceiling notice is measured against. */
  loadedCount: number;
  agents: readonly Agent[];
  pending: boolean;
  error: unknown;
  result: TicketBulkResult | null;
  onApply: (action: TicketBulkAction) => void;
  onClear: () => void;
}): ReactElement | null {
  const t = useTranslate();
  const [choice, setChoice] = useState('');

  // The bar outlives the selection by exactly one report, and that is the whole
  // reason it is written this way. The obvious alternative — clear the ticks on
  // success — takes the summary down with them, and in `My open` the rows leave
  // the view as well, so an agent who solved six tickets and had two skipped
  // would be told nothing at all. Whichever of the two ends first, the numbers
  // stay until the agent dismisses them or starts a new selection.
  if (selectedCount === 0 && !result) return null;

  const options = ticketBulkActionOptions(agents);
  const groups: TicketBulkActionOption['group'][] = ['status', 'priority', 'assignee'];
  const action = ticketBulkActionFor(choice, agents);

  return (
    <div
      aria-label={t('inbox.ticketBulk.ariaLabel')}
      role="group"
      className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 px-4 py-2"
    >
      {selectedCount > 0 && (
        <span className="text-sm font-medium">
          {t('inbox.ticketBulk.selected', { count: selectedCount })}
        </span>
      )}

      {/* The controls belong to a live selection. With nothing ticked the bar is
          a finished sweep's receipt and offers no action — a picker above no
          rows is a control whose Apply could only ever mean nothing. */}
      {selectedCount > 0 && (
        <>
          <label className="flex items-center gap-2 text-xs text-content-secondary">
            {t('inbox.ticketBulk.actionLabel')}
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-content"
            >
              <option value="">{t('inbox.ticketBulk.choose')}</option>
              {groups.map((group) => (
                <optgroup key={group} label={t(GROUP_LABEL_KEY[group])}>
                  {options
                    .filter((option) => option.group === group)
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.labelArg
                          ? t(option.labelKey, { name: option.labelArg })
                          : t(option.labelKey)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={action === null || pending}
            onClick={() => {
              if (action) onApply(action);
            }}
            className="rounded-md bg-brand-500 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('inbox.ticketBulk.apply')}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={onClear}
        className="text-xs text-content-secondary hover:text-content"
      >
        {t('inbox.ticketBulk.clear')}
      </button>

      {/* The ceiling, said once and only when it is actually in the way — the
          header checkbox stops offering "select all" at the same moment. */}
      {loadedCount > TICKET_BULK_MAX && (
        <p className="text-xs text-content-tertiary">
          {t('inbox.ticketBulk.ceiling', { max: TICKET_BULK_MAX })}
        </p>
      )}

      {error != null && (
        <p role="alert" className="text-xs text-danger">
          {t(errorMessageKey(error))}
        </p>
      )}
      {result && !pending && <ResultSummary result={result} />}
    </div>
  );
}
