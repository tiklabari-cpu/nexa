/**
 * Chat timeout (FR-MOD-08.7.3): the idle window before a conversation is
 * auto-closed by the server-side sweep (`ChatTimeoutSweeper`, tm 48). The
 * sweep has run since tm 48; only the console screen to set its window was
 * missing (GL-9 §F.1/7, M-UI-GAP tm 136.1) — `GET/PUT /settings/chat-timeout`
 * already existed with nothing calling it.
 *
 * The server stores whole seconds (1 to 30 days) or `null` for "off". Off is
 * not "never" for widget conversations: they still close after 30 minutes of
 * silence (owner decision K2, ID-02 · tm 286.2), which the hint says so the
 * unchecked box does not read as "conversations stay open". The
 * form lets a person pick a whole number in either minutes or hours rather
 * than doing that arithmetic themselves. The two are independent fields on
 * purpose — switching the unit re-interprets the number already entered
 * (30 → "minutes" to "hours" reads as 30 hours, not a converted 30 minutes),
 * which is the one behaviour that never surprises with a silent rounding.
 *
 * The same card carries the conversation day boundary (ID-04 · tm 285, decision
 * K3): the IANA zone a conversation's day is counted in and the local hour that
 * day starts at. It rides on the same endpoint and row, so it is one form with
 * one Save. The zone picker is a search box over a list rather than a bare
 * <select> of ~420 names, and a live example — computed with the very
 * `localDayKey` the server files chats by — shows which day a chat started right
 * now would land on, the one thing a person editing this cannot otherwise see.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { DEFAULT_DAY_BOUNDARY, isDayBoundaryHour, localDayKey } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { IANA_TIMEZONES, timeZoneOptionLabel } from '../../lib/timezones.js';

interface ChatTimeoutSettings {
  chat_timeout_seconds: number | null;
  /** Absent only from a server that predates ID-04: read as the shipped default. */
  day_boundary_timezone?: string;
  day_boundary_hour?: number;
  updated_at: string | null;
}

interface ChatTimeoutBody {
  chat_timeout_seconds: number | null;
  day_boundary_timezone?: string;
  day_boundary_hour?: number;
}

type DurationUnit = 'minutes' | 'hours';
type FormValues = Record<'enabled' | 'amount' | 'unit' | 'timezone' | 'hour', string>;

// Mirrors the server's ceiling (`apps/api/src/routes/settings.ts`,
// `CHAT_TIMEOUT_MAX_SECONDS`): a window longer than 30 days is
// indistinguishable from "off" but still a number the sweep would act on.
const MAX_SECONDS = 2_592_000;
const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600 };
const DEFAULT_AMOUNT = 30;
const BOUNDARY_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function draftFromSeconds(seconds: number | null): { amount: string; unit: DurationUnit } {
  if (seconds === null) return { amount: String(DEFAULT_AMOUNT), unit: 'minutes' };
  if (seconds % 3600 === 0) return { amount: String(seconds / 3600), unit: 'hours' };
  return { amount: String(Math.max(1, Math.round(seconds / 60))), unit: 'minutes' };
}

/**
 * Only meaningful while `enabled`: off always saves `null` regardless of
 * whatever the (disabled) amount field currently holds, so a stale or blank
 * amount can never block turning the feature off.
 */
function amountError(t: TFunction, values: FormValues): string | null {
  if (values.enabled !== 'true') return null;
  const amount = Number(values.amount);
  if (!Number.isInteger(amount) || amount <= 0) return t('settings.chatTimeout.amountError');
  const seconds = amount * UNIT_SECONDS[values.unit === 'hours' ? 'hours' : 'minutes'];
  return seconds <= MAX_SECONDS ? null : t('settings.chatTimeout.amountError');
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
  const draft = draftFromSeconds(config.chat_timeout_seconds);
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

  const form = useForm<FormValues>({
    initial: {
      enabled: String(config.chat_timeout_seconds !== null),
      amount: draft.amount,
      unit: draft.unit,
      timezone: savedTimezone,
      hour: String(savedHour),
    },
    // No entry here for `amount`: its valid range depends on `unit` and
    // whether `enabled` is on, which a single-field `Validator` cannot see.
    // `amountError` below does that check directly against the whole form.
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      const error = amountError(t, values);
      if (error) {
        setFieldError('amount', error);
        return;
      }
      const body: ChatTimeoutBody = {
        chat_timeout_seconds:
          values.enabled === 'true'
            ? Number(values.amount) * UNIT_SECONDS[values.unit as DurationUnit]
            : null,
      };
      // The boundary goes only when it changed, like the company form's diff: a
      // timeout-only save should not read as a day-boundary change in the audit
      // trail, nor re-send a zone this browser may not even know the name of.
      if (values.timezone !== savedTimezone) body.day_boundary_timezone = values.timezone;
      if (Number(values.hour) !== savedHour) body.day_boundary_hour = Number(values.hour);
      try {
        await save.mutateAsync(body);
      } catch (error_) {
        setSubmitError(t(errorMessageKey(error_)));
      }
    },
  });

  const durationError = amountError(t, form.values);
  const enabled = form.values.enabled === 'true';
  const boundaryHour = Number(form.values.hour);
  const { zones, matched } = matchingZones(zoneSearch, form.values.timezone);

  function setEnabled(checked: boolean): void {
    const next = { ...form.values, enabled: String(checked) };
    form.setValue('enabled', next.enabled);
    form.setFieldError('amount', amountError(t, next));
  }

  function setUnit(unit: DurationUnit): void {
    const next = { ...form.values, unit };
    form.setValue('unit', next.unit);
    form.setFieldError('amount', amountError(t, next));
  }

  function validateAmount(): void {
    form.setFieldError('amount', amountError(t, form.values));
  }

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span className="text-sm">
            {t('settings.chatTimeout.enableLabel')}
            <span className="block text-2xs text-content-tertiary">
              {t('settings.chatTimeout.enableHint')}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-32 flex-col gap-1">
            <label
              htmlFor="chat-timeout-amount"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.chatTimeout.amountLabel')}
            </label>
            <input
              id="chat-timeout-amount"
              type="number"
              min={1}
              disabled={!enabled}
              value={form.values.amount}
              onChange={(event) => form.setValue('amount', event.target.value)}
              onBlur={validateAmount}
              aria-invalid={durationError ? true : undefined}
              aria-describedby={durationError ? 'chat-timeout-amount-error' : undefined}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            />
          </div>

          <div className="flex w-32 flex-col gap-1">
            <label
              htmlFor="chat-timeout-unit"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.chatTimeout.unitLabel')}
            </label>
            <select
              id="chat-timeout-unit"
              disabled={!enabled}
              value={form.values.unit}
              onChange={(event) => setUnit(event.target.value as DurationUnit)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            >
              <option value="minutes">{t('settings.chatTimeout.unitMinutes')}</option>
              <option value="hours">{t('settings.chatTimeout.unitHours')}</option>
            </select>
          </div>
        </div>
        <FieldError id="chat-timeout-amount-error" message={enabled ? durationError : null} />
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

      {canEdit && <FormSaveBar form={form} valid={durationError === null} />}
    </form>
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
