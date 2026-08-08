/**
 * Work scheduler, end to end (PRD §5.3-Vardiya, WORKSCHED-j).
 *
 * The slice is built from six surfaces that each have their own tests — a
 * contract type, two tables with RLS, a presence write path, a forecast core, an
 * API route, and two screens. Every one of them can be green while the chain
 * between them is broken: the editor could PUT a week nothing reads, the
 * availability control could update `routing_status` without appending to the
 * presence log, and the Staffing grid would still render, because it renders
 * whatever the forecast says — including "unknown" for both.
 *
 * So the assertion here is not that the grid appears. It is that the two
 * *unknown* notices are **gone** afterwards. `roster_known` is false until a
 * work_schedules row exists, and `coverage_known` is false until the presence
 * log has an event inside the window (`presence-coverage.ts`: an empty log is
 * null, never 0). Seeing both notices disappear after driving the two writes
 * through the browser is the only proof at this level that the plan the editor
 * saved and the event the availability control appended are the same rows the
 * forecast read back — which is exactly the chain the acceptance criterion
 * names, and nothing below this level can establish.
 *
 * The seed writes neither table, so on a fresh database both notices really are
 * showing when the run starts. They are asserted as absences afterwards rather
 * than as a before/after transition, because the suite shares one database and
 * re-runs against rows an earlier run left behind — a proof that only holds on
 * the first run is not a proof. What keeps the absence honest:
 *
 *   - Both notices are proven to *render* by `ReportsPage.test.tsx`, so an
 *     absence here cannot be a renamed string quietly rendering nothing.
 *   - The roster leg writes whichever shift is not the stored one (see SHIFTS)
 *     and reads it back through a full reload, so the row is one this run wrote.
 *   - The presence leg flips availability away and back, which the API only
 *     records when the status actually changes — two fresh events every run.
 *     That the write happened at all is the select settling on the new value:
 *     `setRoutingStatus` awaits the PUT before touching the store it is
 *     controlled by, and `presence-log.test.ts` covers the same request
 *     appending the event.
 */
import { DEMO, expect, test } from './fixtures.js';

/** A window with no seeded conversations — the honest-empty side of the report. */
const EMPTY_FROM = '2020-01-01';
const EMPTY_TO = '2020-01-07';

/**
 * Two shifts, both distinguishable from `DEFAULT_WORK_SCHEDULE`'s 09:00-18:00.
 *
 * The test writes whichever one is *not* currently stored, so the read-back
 * after the reload proves a write that happened in this run. Writing one fixed
 * shift would pass on every run after the first without the editor doing
 * anything at all — the seed does not truncate, so a row an earlier run left
 * behind would satisfy the assertion on its own.
 */
const SHIFTS = [
  { start: '08:00', end: '20:00' },
  { start: '07:00', end: '19:00' },
] as const;

test.describe('work scheduler → presence → staffing forecast (PRD §5.3-Vardiya)', () => {
  test('a saved shift and a real availability change both reach the Staffing report', async ({
    agentPage,
  }) => {
    // ---- 1. The roster leg: save a week from Team ▸ Work schedule (WORKSCHED-h).
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

    const schedule = agentPage.getByRole('region', { name: 'Work schedule' });
    await expect(schedule).toBeVisible();
    await schedule.getByRole('button', { name: 'Edit schedule' }).click();

    // The owner (an `agents--all:*` holder) opens their own week by default.
    const editor = agentPage.getByRole('dialog', { name: `Work schedule — ${DEMO.agentName}` });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('checkbox', { name: 'Monday' })).toBeChecked();

    // Whichever shift is not the stored one — see SHIFTS.
    const stored = await editor.getByLabel('Monday start time').inputValue();
    const shift = SHIFTS.find((candidate) => candidate.start !== stored) ?? SHIFTS[0];

    await editor.getByLabel('Monday start time').fill(shift.start);
    await editor.getByLabel('Monday end time').fill(shift.end);
    await editor.getByRole('button', { name: 'Save schedule' }).click();

    // Save clears the pending edits only in `onSuccess`, so a disabled submit
    // with no error alert is the mutation having actually been accepted — not
    // the request merely having been sent.
    await expect(editor.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
    await expect(editor.getByRole('alert')).toHaveCount(0);

    // A saved form is clean, so closing must not nag (FR-EK-A.2).
    let nagged = false;
    agentPage.on('dialog', (d) => {
      nagged = true;
      return d.dismiss();
    });
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toBeHidden();
    expect(nagged).toBe(false);

    // A full reload drops every client cache and re-authenticates from the
    // stored refresh token, so reading the shift back here is a round trip to
    // the row rather than to `setQueryData`.
    await agentPage.reload();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await agentPage
      .getByRole('region', { name: 'Work schedule' })
      .getByRole('button', { name: 'Edit schedule' })
      .click();
    const reopened = agentPage.getByRole('dialog', { name: `Work schedule — ${DEMO.agentName}` });
    await expect(reopened.getByLabel('Monday start time')).toHaveValue(shift.start);
    await expect(reopened.getByLabel('Monday end time')).toHaveValue(shift.end);
    await reopened.getByRole('button', { name: 'Cancel' }).click();

    // ---- 2. The presence leg: change availability from the Inbox rail (WORKSCHED-d).
    await agentPage.getByRole('link', { name: 'Inbox' }).click();
    const availability = agentPage.getByLabel('Availability');
    await expect(availability).toBeVisible();

    // `setRoutingStatus` awaits `PUT /agents/me/routing-status` before touching
    // the store, and the select is controlled by it — so the value settling on
    // the new status is the server having accepted the write, which is the same
    // transaction that appends to `agent_presence_events`. The API only writes
    // an event when the status actually changes, hence a flip away and back:
    // two events, and the shared tenant is left accepting chats for the specs
    // that run after this one.
    await availability.selectOption('not_accepting_chats');
    await expect(availability).toHaveValue('not_accepting_chats');
    await availability.selectOption('accepting_chats');
    await expect(availability).toHaveValue('accepting_chats');

    // ---- 3. The read: Reports ▸ Staffing over the default 30-day window.
    await agentPage.goto('/app/reports');
    await agentPage.getByRole('tab', { name: 'Staffing' }).click();
    await expect(agentPage.getByRole('tab', { name: 'Staffing' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const staffing = agentPage.getByRole('region', { name: 'Staffing' });
    await expect(staffing).toBeVisible();

    // The 7 × 24 UTC grid: a "Day" label plus 24 hour columns, one row per weekday.
    await expect(staffing.getByRole('columnheader', { name: 'Day' })).toBeVisible();
    await expect(staffing.getByRole('columnheader')).toHaveCount(25);
    await expect(staffing.getByRole('rowheader')).toHaveCount(7);
    await expect(staffing.getByRole('rowheader', { name: 'Mon' })).toBeVisible();

    // The chain, proven: neither input is unknown any more. Were the editor
    // writing a row the forecast never reads, or the availability control
    // updating `routing_status` without logging the transition, the matching
    // notice would still be here.
    await expect(staffing.getByText('No agent has a saved work schedule yet')).toHaveCount(0);
    await expect(staffing.getByText(/No presence data in this window/)).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/77.10-staffing-grid.png', fullPage: true });
  });

  test('a window with no conversations says so instead of showing a grid of zeroes', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/reports');
    await agentPage.getByRole('tab', { name: 'Staffing' }).click();

    // A historical week the seed never touched: no volume, so nothing to size a
    // recommendation against.
    await agentPage.getByRole('button', { name: 'Custom' }).click();
    await agentPage.getByLabel('Start date').fill(EMPTY_FROM);
    await agentPage.getByLabel('End date').fill(EMPTY_TO);

    // A meaningful empty state (FR-EK-B.1) — and genuinely the empty state, not
    // a grid left rendering 0 in all 168 cells, which would read as "fully
    // staffed, no gaps" for a window nothing is known about.
    await expect(agentPage.getByText('No staffing data in this window')).toBeVisible();
    await expect(agentPage.getByRole('columnheader', { name: 'Day' })).toHaveCount(0);
    await expect(agentPage.getByRole('rowheader', { name: 'Mon' })).toHaveCount(0);

    await agentPage.screenshot({ path: 'kanit/77.10-staffing-empty.png', fullPage: true });
  });
});
