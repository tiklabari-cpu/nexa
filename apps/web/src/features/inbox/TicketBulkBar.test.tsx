/**
 * The bar above the Tickets grid that acts on a selection (FR-13-EK.3 ·
 * FR-MOD-02.7.1).
 *
 * Two of its behaviours are the ones worth a test rather than a glance. Apply
 * has to be a *second* gesture — a control that fired on change would move
 * fifty tickets on one slip — and the summary has to report a partial outcome
 * honestly, because `POST /tickets/bulk` answers 200 when rows were skipped and
 * a bar that read a resolved request as an all-clear would tell an agent "done"
 * about tickets that never moved.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketBulkBar } from './TicketBulkBar.js';
import { TICKET_BULK_MAX } from './ticket-selection.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { TicketBulkResult } from './useTickets.js';
import type { Agent } from './types.js';

const AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: 'Dara Okonjo',
    email: 'dara@example.com',
    avatar_url: null,
    role: 'agent',
    routing_status: 'accepting_chats',
    concurrent_chats_limit: 5,
  },
];

type BarProps = Parameters<typeof TicketBulkBar>[0];

function renderBar(props: Partial<BarProps> = {}) {
  const onApply = vi.fn();
  const onClear = vi.fn();
  const view = render(
    <TicketBulkBar
      selectedCount={3}
      loadedCount={12}
      agents={AGENTS}
      pending={false}
      error={null}
      result={null}
      onApply={onApply}
      onClear={onClear}
      {...props}
    />,
  );
  return { onApply, onClear, ...view };
}

afterEach(() => resetLocale());

describe('TicketBulkBar (FR-13-EK.3)', () => {
  it('renders nothing at all until something is ticked', () => {
    const { container } = renderBar({ selectedCount: 0 });
    // Not "renders disabled controls": an always-present row of dead buttons
    // above a queue is furniture, and it costs the grid a row of height.
    expect(container).toBeEmptyDOMElement();
  });

  it('says how many rows the next action will touch', () => {
    renderBar({ selectedCount: 6 });
    expect(screen.getByText('6 tickets selected')).toBeInTheDocument();
  });

  it('uses the singular for one row', () => {
    renderBar({ selectedCount: 1 });
    expect(screen.getByText('1 ticket selected')).toBeInTheDocument();
  });

  it('keeps Apply disabled until an action is chosen', async () => {
    renderBar();
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Action'), 'status:solved');
    expect(apply).toBeEnabled();
  });

  it('does not act on the picker alone — Apply is the second gesture', async () => {
    const { onApply } = renderBar();
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'status:solved');
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ status: 'solved' });
  });

  it('sends an assignment as the agent id and an unassign as an explicit null', async () => {
    const { onApply } = renderBar();
    const picker = screen.getByLabelText('Action');

    await userEvent.selectOptions(picker, 'assignee:agent-1');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenLastCalledWith({ assignee_id: 'agent-1' });

    await userEvent.selectOptions(picker, 'assignee:none');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenLastCalledWith({ assignee_id: null });
  });

  it('refuses to fire again while the request is in flight', () => {
    renderBar({ pending: true });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('clears the selection on request', async () => {
    const { onClear } = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe('the result summary', () => {
    const report = (over: Partial<TicketBulkResult> = {}): TicketBulkResult => ({
      updated: 4,
      failed: 2,
      results: [
        { ticket_id: 'T1', status: 'updated', reason: null },
        { ticket_id: 'T2', status: 'skipped', reason: 'merged' },
        { ticket_id: 'T3', status: 'skipped', reason: 'not_found' },
      ],
      ...over,
    });

    it('prints both numbers, so a partial outcome cannot read as success', () => {
      renderBar({ result: report() });
      // The specific bug this pins: a bar that showed only `updated` would say
      // "4 updated" about a selection of six and be believed.
      expect(screen.getByRole('status')).toHaveTextContent('4 updated, 2 skipped');
    });

    it('names why rows were skipped, counted rather than listed', () => {
      renderBar({ result: report() });
      const summary = screen.getByRole('status');
      expect(summary).toHaveTextContent('1 merged into another ticket');
      expect(summary).toHaveTextContent('1 no longer in this view');
    });

    it('adds no reason line when everything succeeded', () => {
      renderBar({
        result: report({
          updated: 1,
          failed: 0,
          results: [{ ticket_id: 'T1', status: 'updated', reason: null }],
        }),
      });
      const summary = screen.getByRole('status');
      expect(summary).toHaveTextContent('1 updated, 0 skipped');
      expect(summary).not.toHaveTextContent('merged');
    });

    it('hides the previous report while a new request is running', () => {
      // A summary of the last sweep sitting above a running one reads as the
      // answer to the sweep in progress.
      renderBar({ result: report(), pending: true });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('outlives the selection it counted, and offers no action without one', () => {
      // Solving a queue in `My open` takes those rows — and their ticks — out
      // of the view. A bar that unmounted with the last tick would take the
      // skipped rows' reasons with it, which is the one thing this summary
      // exists to say.
      renderBar({ selectedCount: 0, result: report() });
      expect(screen.getByRole('status')).toHaveTextContent('4 updated, 2 skipped');
      expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Action')).not.toBeInTheDocument();
      // …but something still has to be able to put it away.
      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });
  });

  it('shows a refused request as an alert, in the catalogue’s words', () => {
    renderBar({
      error: new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'raw server prose',
        requestId: 'req-1',
      }),
    });
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    // Never the server's own sentence: it is untranslated and written for a
    // developer (the i18n sentinel checks this class of leak repo-wide).
    expect(alert).not.toHaveTextContent('raw server prose');
  });

  it('mentions the ceiling only once the grid has outgrown it', () => {
    renderBar({ loadedCount: TICKET_BULK_MAX });
    expect(screen.queryByText(/at most/)).not.toBeInTheDocument();

    renderBar({ loadedCount: TICKET_BULK_MAX + 1 });
    expect(screen.getByText(`One action covers at most ${TICKET_BULK_MAX} tickets.`)).toBeVisible();
  });

  it('paints in Turkish when that is the active locale (NFR-I18N2)', () => {
    renderWithLocale(
      <TicketBulkBar
        selectedCount={3}
        loadedCount={12}
        agents={AGENTS}
        pending={false}
        error={null}
        result={null}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
      'tr',
    );
    expect(screen.getByText('3 talep seçildi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
  });
});
