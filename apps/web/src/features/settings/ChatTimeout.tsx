/**
 * Inactivity, chat timeout and day boundary (FR-MOD-08.7.3 · WG-03).
 *
 * Three windows, in the order a conversation goes quiet, each saved in whole
 * seconds (or `null` for "off") on the same `inbox_settings` row:
 *
 *   1. **Pass on unanswered chats** (`unanswered_transfer_seconds`, tm 340): an
 *      agent who has not sent a first reply this long after a chat was given to
 *      them loses it to someone else in the team — the server's
 *      `chat_inactivity` sweep. Beside it, whether that agent is also set to
 *      "not accepting" (`pause_unresponsive_agents`, on unless turned off).
 *   2. **Mark quiet chats inactive** (`inactive_after_seconds`): no event this
 *      long and the chat stops counting against its agent's limit; the inbox
 *      dims it until the next message.
 *   3. **Close idle chats** (`chat_timeout_seconds`, tm 48): the auto-close.
 *      Off is not "never" for widget conversations: they still close after 30
 *      minutes of silence (owner decision K2, ID-02 · tm 286.2), which the hint
 *      says so the unchecked box does not read as "conversations stay open".
 *
 * They only make sense strictly in that order, so a set of windows out of order
 * is refused here — the same `chatInactivityOrderProblem` the server runs on
 * the saved result (400 `details.problem`), so the two cannot disagree about
 * what "in order" means. A window that is off is in no pair.
 *
 * Each window is a whole number in minutes or hours rather than seconds a person
 * would have to work out. Switching the unit re-interprets the number already
 * entered (30 → "minutes" to "hours" reads as 30 hours, not a converted 30
 * minutes), the one behaviour that never surprises with a silent rounding.
 *
 * The same card carries the conversation day boundary (ID-04 · tm 285, decision
 * K3): the IANA zone a conversation's day is counted in and the local hour that
 * day starts at. The zone picker is a search box over a list rather than a bare
 * <select> of ~420 names, and a live example — computed with the very
 * `localDayKey` the server files chats by — shows which day a chat started right
 * now would land on, the one thing a person editing this cannot otherwise see.
 *
 * A save sends `chat_timeout_seconds` (the endpoint requires it) and every other
 * field only when it changed, like the company form's diff: a timeout-only save
 * should not read as a transfer or day-boundary change in the audit trail.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  CHAT_INACTIVITY_ORDER_PROBLEMS,
  DEFAULT_DAY_BOUNDARY,
  INACTIVITY_WINDOW_MAX_SECONDS,
  chatInactivityOrderProblem,
  isDayBoundaryHour,
  localDayKey,
  type ChatInactivityOrderProblem,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { IANA_TIMEZONES, timeZoneOptionLabel } from '../../lib/timezones.js';

interface ChatTimeoutSettings {
  chat_timeout_seconds: number | null;
  /** Absent only from a server that predates ID-04: read as the shipped default. */
  day_boundary_timezone?: string;
  day_boundary_hour?: number;
  /** Absent only from a server that predates WG-03: read as off. */
  unanswered_transfer_seconds?: number | null;
  inactive_after_seconds?: number | null;
  /** Absent only from a server that predates tm 340.2: read as the column's default, on. */
  pause_unresponsive_agents?: boolean;
  updated_at: string | null;
}

interface ChatTimeoutBody {
  chat_timeout_seconds: number | null;
  day_boundary_timezone?: string;
  day_boundary_hour?: number;
  unanswered_transfer_seconds?: number | null;
  inactive_after_seconds?: number | null;
  pause_unresponsive_agents?: boolean;
}

type DurationUnit = 'minutes' | 'hours';
/** The three windows, in the order a conversation goes quiet. */
type Window = 'transfer' | 'inactive' | 'timeout';
type FormValues = Record<
  `${Window}Enabled` | `${Window}Amount` | `${Window}Unit` | 'pause' | 'timezone' | 'hour',
  string
>;

// Mirrors the server's ceilings (`apps/api/src/routes/settings.ts`,
// `CHAT_TIMEOUT_MAX_SECONDS` and `INACTIVITY_WINDOW_MAX_SECONDS`): a window
// longer than 30 days is indistinguishable from "off" but still a number the
// sweeps would act on.
const MAX_SECONDS = INACTIVITY_WINDOW_MAX_SECONDS;
const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600 };
/** What an off window's amount box offers if it is turned on — 05 WG-03's defaults. */
const DEFAULT_AMOUNTS: Record<Window, number> = { transfer: 3, inactive: 10, timeout: 30 };
const BOUNDARY_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const ORDER_MESSAGE_KEYS: Record<ChatInactivityOrderProblem, string> = {
  transfer_not_before_inactive: 'settings.chatTimeout.order.transferBeforeInactive',
  transfer_not_before_timeout: 'settings.chatTimeout.order.transferBeforeTimeout',
  inactive_not_before_timeout: 'settings.chatTimeout.order.inactiveBeforeTimeout',
};

function draftFromSeconds(
  seconds: number | null,
  window: Window,
): { amount: string; unit: DurationUnit } {
  if (seconds === null) return { amount: String(DEFAULT_AMOUNTS[window]), unit: 'minutes' };
  if (seconds % 3600 === 0) return { amount: String(seconds / 3600), unit: 'hours' };
  return { amount: String(Math.max(1, Math.round(seconds / 60))), unit: 'minutes' };
}

/**
 * Only meaningful while the window is on: off always saves `null` regardless
 * of whatever the (disabled) amount field currently holds, so a stale or blank
 * amount can never block turning a window off.
 */
function amountError(t: TFunction, values: FormValues, window: Window): string | null {
  if (values[`${window}Enabled`] !== 'true') return null;
  const amount = Number(values[`${window}Amount`]);
  if (!Number.isInteger(amount) || amount <= 0) return t('settings.chatTimeout.amountError');
  return secondsOf(values, window)! <= MAX_SECONDS ? null : t('settings.chatTimeout.amountError');
}

/** The window as it would be saved: whole seconds, or null while off. */
function secondsOf(values: FormValues, window: Window): number | null {
  if (values[`${window}Enabled`] !== 'true') return null;
  const unit = values[`${window}Unit`] === 'hours' ? 'hours' : 'minutes';
  return Number(values[`${window}Amount`]) * UNIT_SECONDS[unit];
}

/** The pair out of order, judged only once every amount that is on is valid. */
function orderProblem(values: FormValues): ChatInactivityOrderProblem | null {
  return chatInactivityOrderProblem({
    unansweredTransferSeconds: secondsOf(values, 'transfer'),
    inactiveAfterSeconds: secondsOf(values, 'inactive'),
    chatTimeoutSeconds: secondsOf(values, 'timeout'),
  });
}

/** The server's own refusal of an out-of-order save, read back as the same message. */
function serverOrderProblem(error: unknown): ChatInactivityOrderProblem | null {
  if (!(error instanceof ApiClientError) || error.type !== 'validation') return null;
  const problem = error.details?.['problem'];
  return (CHAT_INACTIVITY_ORDER_PROBLEMS as readonly unknown[]).includes(problem)
    ? (problem as ChatInactivityOrderProblem)
    : null;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * The zones a search box offers: names matching every typed word (case-blind,
 * underscores read as spaces, so `new york` finds `America/New_York`) or the
 * UTC offset as shown (`utc+3`). The selected zone is always kept, so
 * narrowing the list never makes the current value vanish from its own picker.
 */
function matchingZones(search: string, selected: string): { zones: string[]; matched: number } {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches =
    words.length === 0
      ? [...IANA_TIMEZONES]
      : IANA_TIMEZONES.filter((zone) => {
          const haystack =
            `${zone.replaceAll('_', ' ')} ${timeZoneOptionLabel(zone)}`.toLowerCase();
          return words.every((word) => haystack.includes(word));
        });
  return {
    zones: matches.includes(selected) ? matches : [selected, ...matches],
    matched: matches.length,
  };
}

/** The wall-clock time `at` shows in `timezone`, 24-hour, e.g. `14:05`. */
function clockIn(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

export function ChatTimeout({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'chat-timeout'],
    queryFn: () => api.get<ChatTimeoutSettings>('/settings/chat-timeout'),
  });

  if (settings.error) return <ErrorNotice message={t('settings.chatTimeout.loadError')} />;

  return (
    <Section
      id="section-chat-timeout"
      title={t('settings.chatTimeout.title')}
      description={t('settings.chatTimeout.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <ChatTimeoutForm
            config={settings.data}
            canEdit={canEdit}
            onSaved={(data) => queryClient.setQueryData(['settings', 'chat-timeout'], data)}
          />
        )}
      </Card>
    </Section>
  );
}

/**
 * Mounted only once the server's configuration has loaded, so `useForm`'s
 * `initial` is the real saved values on the very first render rather than the
 * shipped defaults racing an in-flight fetch (`SalesTrackerForm`'s reasoning).
 */
function ChatTimeoutForm({
  config,
  canEdit,
  onSaved,
}: {
  config: ChatTimeoutSettings;
  canEdit: boolean;
  onSaved: (data: ChatTimeoutSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const saved: Record<Window, number | null> = {
    transfer: config.unanswered_transfer_seconds ?? null,
    inactive: config.inactive_after_seconds ?? null,
    timeout: config.chat_timeout_seconds,
  };
  const savedPause = config.pause_unresponsive_agents ?? true;
  const savedTimezone = config.day_boundary_timezone ?? DEFAULT_DAY_BOUNDARY.timezone;
  const savedHour = config.day_boundary_hour ?? DEFAULT_DAY_BOUNDARY.hour;
  // The zone search narrows the list; it is not part of what is saved, so it
  // lives outside the form and never makes the form dirty.
  const [zoneSearch, setZoneSearch] = useState('');

  const save = useMutation({
    mutationFn: (body: ChatTimeoutBody) =>
      api.put<ChatTimeoutSettings>('/settings/chat-timeout', body),
    onSuccess: onSaved,
  });

  const initial = {} as FormValues;
  for (const window of ['transfer', 'inactive', 'timeout'] as const) {
    const draft = draftFromSeconds(saved[window], window);
    initial[`${window}Enabled`] = String(saved[window] !== null);
    initial[`${window}Amount`] = draft.amount;
    initial[`${window}Unit`] = draft.unit;
  }
  initial.pause = String(savedPause);
  initial.timezone = savedTimezone;
  initial.hour = String(savedHour);

  const form = useForm<FormValues>({
    initial,
    // No validators here for the amounts: each one's valid range depends on its
    // unit and its switch, and their order on all three, which a single-field
    // `Validator` cannot see. `amountError` and `orderProblem` check the form.
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      let invalid = false;
      for (const window of ['transfer', 'inactive', 'timeout'] as const) {
        const error = amountError(t, values, window);
        if (error) {
          setFieldError(`${window}Amount`, error);
          invalid = true;
        }
      }
      if (invalid || orderProblem(values)) return;

      const windows: Record<Window, number | null> = {
        transfer: secondsOf(values, 'transfer'),
        inactive: secondsOf(values, 'inactive'),
        timeout: secondsOf(values, 'timeout'),
      };
      const body: ChatTimeoutBody = { chat_timeout_seconds: windows.timeout };
      if (windows.transfer !== saved.transfer) body.unanswered_transfer_seconds = windows.transfer;
      if (windows.inactive !== saved.inactive) body.inactive_after_seconds = windows.inactive;
      if ((values.pause === 'true') !== savedPause) {
        body.pause_unresponsive_agents = values.pause === 'true';
      }
      if (values.timezone !== savedTimezone) body.day_boundary_timezone = values.timezone;
      if (Number(values.hour) !== savedHour) body.day_boundary_hour = Number(values.hour);
      try {
        await save.mutateAsync(body);
      } catch (error_) {
        const problem = serverOrderProblem(error_);
        setSubmitError(t(problem ? ORDER_MESSAGE_KEYS[problem] : errorMessageKey(error_)));
      }
    },
  });

  const errors: Record<Window, string | null> = {
    transfer: amountError(t, form.values, 'transfer'),
    inactive: amountError(t, form.values, 'inactive'),
    timeout: amountError(t, form.values, 'timeout'),
  };
  const amountsValid = Object.values(errors).every((error) => error === null);
  const problem = amountsValid ? orderProblem(form.values) : null;
  const boundaryHour = Number(form.values.hour);
  const { zones, matched } = matchingZones(zoneSearch, form.values.timezone);

  /** Change one field and re-judge its window's amount against the result. */
  function setWindowField(window: Window, field: 'Enabled' | 'Unit', value: string): void {
    const next = { ...form.values, [`${window}${field}`]: value };
    form.setValue(`${window}${field}`, value);
    form.setFieldError(`${window}Amount`, amountError(t, next, window));
  }

  const rows: Array<{ window: Window; id: string; extra?: ReactNode }> = [
    {
      window: 'transfer',
      id: 'unanswered-transfer',
      extra: (
        <label className="flex items-start gap-3 pl-7">
          <input
            type="checkbox"
            checked={form.values.pause === 'true'}
            disabled={form.values.transferEnabled !== 'true'}
            onChange={(event) => form.setValue('pause', String(event.target.checked))}
          />
          <span className="text-sm">
            {t('settings.chatTimeout.pauseLabel')}
            <span className="block text-2xs text-content-tertiary">
              {t('settings.chatTimeout.pauseHint')}
            </span>
          </span>
        </label>
      ),
    },
    { window: 'inactive', id: 'inactive-after' },
    { window: 'timeout', id: 'chat-timeout' },
  ];

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <p className="text-2xs text-content-tertiary">{t('settings.chatTimeout.orderHint')}</p>
        {rows.map(({ window, id, extra }) => (
          <WindowRow
            key={window}
            id={id}
            window={window}
            values={form.values}
            error={errors[window]}
            onEnabled={(checked) => setWindowField(window, 'Enabled', String(checked))}
            onAmount={(value) => form.setValue(`${window}Amount`, value)}
            onAmountBlur={() =>
              form.setFieldError(`${window}Amount`, amountError(t, form.values, window))
            }
            onUnit={(unit) => setWindowField(window, 'Unit', unit)}
          >
            {extra}
          </WindowRow>
        ))}
        <FieldError
          id="chat-inactivity-order-error"
          message={problem ? t(ORDER_MESSAGE_KEYS[problem]) : null}
        />
      </fieldset>

      <fieldset
        disabled={!canEdit}
        aria-labelledby="day-boundary-heading"
        className="flex flex-col gap-4 border-0 border-t border-border p-0 pt-5"
      >
        <div>
          <h3 id="day-boundary-heading" className="text-sm font-medium">
            {t('settings.dayBoundary.heading')}
          </h3>
          <p className="text-2xs text-content-tertiary">{t('settings.dayBoundary.description')}</p>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <div className="flex w-72 flex-col gap-1">
            <label
              htmlFor="day-boundary-zone-search"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.dayBoundary.searchLabel')}
            </label>
            <input
              id="day-boundary-zone-search"
              type="search"
              value={zoneSearch}
              onChange={(event) => setZoneSearch(event.target.value)}
              placeholder={t('settings.dayBoundary.searchPlaceholder')}
              autoComplete="off"
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            />
            <label
              htmlFor="day-boundary-zone"
              className="mt-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.dayBoundary.zoneLabel')}
            </label>
            <select
              id="day-boundary-zone"
              size={6}
              value={form.values.timezone}
              onChange={(event) => form.setValue('timezone', event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {timeZoneOptionLabel(zone)}
                </option>
              ))}
            </select>
            {zoneSearch.trim() !== '' && matched === 0 && (
              <p className="text-2xs text-content-tertiary">{t('settings.dayBoundary.noMatch')}</p>
            )}
          </div>

          <div className="flex w-40 flex-col gap-1">
            <label
              htmlFor="day-boundary-hour"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.dayBoundary.hourLabel')}
            </label>
            <select
              id="day-boundary-hour"
              value={form.values.hour}
              onChange={(event) => form.setValue('hour', event.target.value)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            >
              {BOUNDARY_HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DayBoundaryExample timezone={form.values.timezone} hour={boundaryHour} />

        <p className="text-2xs text-content-tertiary">{t('settings.dayBoundary.scopeNote')}</p>
      </fieldset>

      {canEdit && <FormSaveBar form={form} valid={amountsValid && problem === null} />}
    </form>
  );
}

/** Catalogue keys per window; the auto-close row keeps the keys it always had. */
const ROW_KEYS: Record<Window, { enable: string; hint: string; amount: string; unit: string }> = {
  transfer: {
    enable: 'settings.chatTimeout.transfer.enableLabel',
    hint: 'settings.chatTimeout.transfer.enableHint',
    amount: 'settings.chatTimeout.transfer.amountLabel',
    unit: 'settings.chatTimeout.transfer.unitLabel',
  },
  inactive: {
    enable: 'settings.chatTimeout.inactive.enableLabel',
    hint: 'settings.chatTimeout.inactive.enableHint',
    amount: 'settings.chatTimeout.inactive.amountLabel',
    unit: 'settings.chatTimeout.inactive.unitLabel',
  },
  timeout: {
    enable: 'settings.chatTimeout.enableLabel',
    hint: 'settings.chatTimeout.enableHint',
    amount: 'settings.chatTimeout.amountLabel',
    unit: 'settings.chatTimeout.unitLabel',
  },
};

/** One window: its switch with what it does, then the amount and the unit. */
function WindowRow({
  id,
  window,
  values,
  error,
  onEnabled,
  onAmount,
  onAmountBlur,
  onUnit,
  children,
}: {
  id: string;
  window: Window;
  values: FormValues;
  error: string | null;
  onEnabled: (checked: boolean) => void;
  onAmount: (value: string) => void;
  onAmountBlur: () => void;
  onUnit: (unit: DurationUnit) => void;
  children?: ReactNode;
}): ReactElement {
  const t = useTranslate();
  const keys = ROW_KEYS[window];
  const enabled = values[`${window}Enabled`] === 'true';
  const errorId = `${id}-amount-error`;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        <span className="text-sm">
          {t(keys.enable)}
          <span className="block text-2xs text-content-tertiary">{t(keys.hint)}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-end gap-3 pl-7">
        <div className="flex w-32 flex-col gap-1">
          <label
            htmlFor={`${id}-amount`}
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t(keys.amount)}
          </label>
          <input
            id={`${id}-amount`}
            type="number"
            min={1}
            disabled={!enabled}
            value={values[`${window}Amount`]}
            onChange={(event) => onAmount(event.target.value)}
            onBlur={onAmountBlur}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
          />
        </div>

        <div className="flex w-32 flex-col gap-1">
          <label
            htmlFor={`${id}-unit`}
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t(keys.unit)}
          </label>
          <select
            id={`${id}-unit`}
            disabled={!enabled}
            value={values[`${window}Unit`]}
            onChange={(event) => onUnit(event.target.value as DurationUnit)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
          >
            <option value="minutes">{t('settings.chatTimeout.unitMinutes')}</option>
            <option value="hours">{t('settings.chatTimeout.unitHours')}</option>
          </select>
        </div>
      </div>
      <div className="pl-7">
        <FieldError id={errorId} message={enabled ? error : null} />
      </div>
      {children}
    </div>
  );
}

/**
 * What the chosen zone and hour mean right now: the local time, the day a chat
 * started this moment is filed under, and where the day begins and ends. Built
 * with `localDayKey` — the function the server files chats by — so the example
 * and the behaviour cannot drift apart.
 */
function DayBoundaryExample({
  timezone,
  hour,
}: {
  timezone: string;
  hour: number;
}): ReactElement | null {
  const t = useTranslate();
  if (!isDayBoundaryHour(hour)) return null;

  const now = new Date();
  let day: string;
  let time: string;
  try {
    day = localDayKey(now, timezone, hour);
    time = clockIn(now, timezone);
  } catch {
    // A stored zone this browser's engine does not know: say nothing rather than guess.
    return null;
  }

  const start = hourLabel(hour);
  const before = `${String(hour === 0 ? 23 : hour - 1).padStart(2, '0')}:59`;
  return (
    <div
      role="note"
      aria-label={t('settings.dayBoundary.exampleLabel')}
      className="rounded-md border border-border bg-inset p-3 text-2xs text-content-secondary"
    >
      <p>{t('settings.dayBoundary.exampleNow', { time, zone: timezone, day })}</p>
      <p>
        {hour === 0
          ? t('settings.dayBoundary.exampleSpanMidnight')
          : t('settings.dayBoundary.exampleSpan', { start, before })}
      </p>
    </div>
  );
}
