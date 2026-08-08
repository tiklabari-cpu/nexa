/**
 * Team → Work schedule (PRD §5.3-Vardiya, WORKSCHED-h).
 *
 * A standing weekly plan per agent — timezone plus a start/end/enabled slot
 * for each of the seven days — read by the staffing forecast (WORKSCHED-g) to
 * predict coverage gaps ahead of time. `GET`/`PUT /agents/{agentId}/work-schedule`
 * (WORKSCHED-c) draws the same self-vs-admin line the route enforces: a plain
 * agent may only look at their own week (`agents--my:*`), an admin may pick
 * anyone on the roster (`agents--all:*`) — mirrored here so an unusable picker
 * entry never appears, rather than existing and then 403ing.
 *
 * The one validation gate is `@nexa/types` `normalizeWorkSchedule` — the same
 * function the route runs on the way in, so the editor and the server can never
 * drift into disagreeing about what a valid week is (start strictly before end,
 * a known weekday, 24h `HH:MM`). Saving always sends the normalised shape.
 *
 * Assumption: the route never reports "no plan" — an agent with no saved row
 * reads back `DEFAULT_WORK_SCHEDULE`, so "not set" and "set to the default"
 * are the same answer (WORKSCHED-c). The empty state this screen owns
 * (FR-EK-B.1) is therefore the roster itself: nobody the viewer may schedule
 * yet, not an individual agent's plan.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_WORK_SCHEDULE,
  WORK_SCHEDULE_DAYS,
  WORK_SCHEDULE_TIME_PATTERN,
  isWorkScheduleProblem,
  normalizeWorkSchedule,
  type WorkSchedule as WorkScheduleValue,
  type WorkScheduleDay,
  type WorkScheduleSlot,
} from '@nexa/types';
import { Card, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';

const DAY_LABEL: Record<WorkScheduleDay, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * `Intl.supportedValuesOf('timeZone')` does not include the `UTC` alias on
 * every engine, and `DEFAULT_WORK_SCHEDULE.timezone` is `'UTC'` — prepended so
 * the shipped default is always a selectable option, not just a stored value.
 * Falls back to a short, workable list for an engine without the API at all.
 */
const TIMEZONES: readonly string[] = (() => {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC', 'Europe/Istanbul', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
  }
})();

interface AgentOption {
  id: string;
  name: string;
}

interface WorkScheduleProps {
  agents: AgentOption[];
  currentAgentId: string | null;
  /** Holds `agents--all:*` — may open anyone's week, not only their own. */
  canManage: boolean;
  /** The roster query is still in flight — render a skeleton, not an empty state. */
  loading: boolean;
}

export function WorkSchedule({
  agents,
  currentAgentId,
  canManage,
  loading,
}: WorkScheduleProps): ReactElement {
  const selectable = useMemo(
    () => (canManage ? agents : agents.filter((agent) => agent.id === currentAgentId)),
    [agents, canManage, currentAgentId],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const activeId =
    (pickedId && selectable.some((agent) => agent.id === pickedId) ? pickedId : null) ??
    (currentAgentId && selectable.some((agent) => agent.id === currentAgentId)
      ? currentAgentId
      : (selectable[0]?.id ?? null));
  const activeAgent = selectable.find((agent) => agent.id === activeId) ?? null;

  return (
    <Section
      title="Work schedule"
      description="Each teammate's standing weekly hours — what the staffing forecast reads to predict coverage gaps."
    >
      <Card>
        {loading ? (
          <ListSkeleton rows={2} />
        ) : selectable.length === 0 ? (
          <EmptyState
            title="No one to schedule yet"
            description="Invite teammates before setting up a work schedule."
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            {selectable.length > 1 ? (
              <div className="flex items-center gap-2 text-sm">
                <label htmlFor="work-schedule-agent" className="text-content-secondary">
                  Teammate
                </label>
                <select
                  id="work-schedule-agent"
                  value={activeId ?? ''}
                  onChange={(event) => setPickedId(event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
                >
                  {selectable.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.id === currentAgentId ? `${agent.name} (you)` : agent.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm">
                {activeAgent?.id === currentAgentId ? 'Your weekly hours' : activeAgent?.name}
              </p>
            )}

            {activeId && activeAgent && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
              >
                Edit schedule
              </button>
            )}
          </div>
        )}
      </Card>

      {open && activeId && activeAgent && (
        <WorkScheduleModal
          agentId={activeId}
          agentName={activeAgent.name}
          onClose={() => setOpen(false)}
        />
      )}
    </Section>
  );
}

/** The editable subset — everything the settings form may still be drafting. */
type Edits = Partial<WorkScheduleValue>;

function WorkScheduleModal({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Edits>({});

  const query = useQuery({
    queryKey: ['team', 'work-schedule', agentId],
    queryFn: () => api.get<WorkScheduleValue>(`/agents/${agentId}/work-schedule`),
  });

  const current = query.data;
  const value: WorkScheduleValue = {
    ...DEFAULT_WORK_SCHEDULE,
    ...(current ?? {}),
    ...edits,
  };
  const dirty = Object.keys(edits).length > 0;

  const slotByDay = useMemo(() => {
    const map = new Map<WorkScheduleDay, WorkScheduleSlot>();
    for (const slot of value.schedule) map.set(slot.day, slot);
    return map;
  }, [value.schedule]);

  // A day absent from the stored week (a row written before every day was
  // required, or by another client entirely) still gets a row here — off, with
  // a sane placeholder range — so the grid is always the full seven, never a
  // partial one that looks broken.
  function slotFor(day: WorkScheduleDay): WorkScheduleSlot {
    return slotByDay.get(day) ?? { day, start: '09:00', end: '18:00', enabled: false };
  }

  function setSlot(day: WorkScheduleDay, patch: Partial<WorkScheduleSlot>): void {
    const next = WORK_SCHEDULE_DAYS.map((candidate) => {
      const slot = slotFor(candidate);
      return candidate === day ? { ...slot, ...patch } : slot;
    });
    setEdits((prev) => ({ ...prev, schedule: next }));
  }

  const dayErrors: Partial<Record<WorkScheduleDay, string>> = {};
  for (const day of WORK_SCHEDULE_DAYS) {
    const slot = slotFor(day);
    if (!slot.enabled) continue;
    const startOk = WORK_SCHEDULE_TIME_PATTERN.test(slot.start);
    const endOk = WORK_SCHEDULE_TIME_PATTERN.test(slot.end);
    if (!startOk || !endOk) {
      dayErrors[day] = 'Enter a 24-hour time, like 09:00.';
    } else if (slot.start >= slot.end) {
      dayErrors[day] = 'End must be after start.';
    }
  }
  const hasErrors = Object.keys(dayErrors).length > 0;

  const save = useMutation({
    mutationFn: () => {
      // Every reason `normalizeWorkSchedule` could reject a slot is already
      // caught by `dayErrors` above (submit stays disabled until clean), so
      // this only guards the two ever disagreeing rather than gating on it.
      const normalised = normalizeWorkSchedule(value);
      if (isWorkScheduleProblem(normalised)) {
        throw new Error(normalised.problem.message);
      }
      return api.put<WorkScheduleValue>(`/agents/${agentId}/work-schedule`, normalised);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['team', 'work-schedule', agentId], data);
      setEdits({});
    },
  });

  const close = useCloseGuard({
    isDirty: dirty,
    message: 'Discard your unsaved schedule changes?',
    onClose,
  });

  return (
    <Modal
      onClose={close}
      title={`Work schedule — ${agentName}`}
      description="Standing weekly hours, in this teammate's own timezone. An off day keeps its configured hours, just switched off."
      className="max-w-lg"
    >
      {query.isPending ? (
        <p className="text-sm text-content-secondary">Loading…</p>
      ) : query.error ? (
        <p className="text-sm text-danger">Could not load this schedule.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && !hasErrors) save.mutate();
          }}
        >
          <label htmlFor="work-schedule-timezone" className="mb-1.5 block text-sm font-medium">
            Timezone
          </label>
          <select
            id="work-schedule-timezone"
            value={value.timezone}
            onChange={(event) => setEdits((prev) => ({ ...prev, timezone: event.target.value }))}
            className="mb-4 w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            {!TIMEZONES.includes(value.timezone) && (
              <option value={value.timezone}>{value.timezone}</option>
            )}
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>

          <div className="flex flex-col gap-2">
            {WORK_SCHEDULE_DAYS.map((day) => {
              const slot = slotFor(day);
              const error = dayErrors[day] ?? null;
              return (
                <div key={day} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={slot.enabled}
                        onChange={(event) => setSlot(day, { enabled: event.target.checked })}
                      />
                      {DAY_LABEL[day]}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="09:00"
                      aria-label={`${DAY_LABEL[day]} start time`}
                      value={slot.start}
                      disabled={!slot.enabled}
                      onChange={(event) => setSlot(day, { start: event.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `work-schedule-${day}-error` : undefined}
                      className="w-20 rounded-md border border-border bg-inset px-2 py-1 text-sm disabled:opacity-40"
                    />
                    <span aria-hidden="true" className="text-content-tertiary">
                      –
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="18:00"
                      aria-label={`${DAY_LABEL[day]} end time`}
                      value={slot.end}
                      disabled={!slot.enabled}
                      onChange={(event) => setSlot(day, { end: event.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `work-schedule-${day}-error` : undefined}
                      className="w-20 rounded-md border border-border bg-inset px-2 py-1 text-sm disabled:opacity-40"
                    />
                  </div>
                  <FieldError id={`work-schedule-${day}-error`} message={error} />
                </div>
              );
            })}
          </div>

          {save.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {save.error instanceof ApiClientError
                ? save.error.message
                : 'Could not save this schedule.'}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!dirty || hasErrors || save.isPending}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {save.isPending ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
