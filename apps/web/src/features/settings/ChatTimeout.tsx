/**
 * Chat timeout (FR-MOD-08.7.3): the idle window before a conversation is
 * auto-closed by the server-side sweep (`ChatTimeoutSweeper`, tm 48). The
 * sweep has run since tm 48; only the console screen to set its window was
 * missing (GL-9 §F.1/7, M-UI-GAP tm 136.1) — `GET/PUT /settings/chat-timeout`
 * already existed with nothing calling it.
 *
 * The server stores whole seconds (1 to 30 days) or `null` for "off"; the
 * form lets a person pick a whole number in either minutes or hours rather
 * than doing that arithmetic themselves. The two are independent fields on
 * purpose — switching the unit re-interprets the number already entered
 * (30 → "minutes" to "hours" reads as 30 hours, not a converted 30 minutes),
 * which is the one behaviour that never surprises with a silent rounding.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface ChatTimeoutSettings {
  chat_timeout_seconds: number | null;
  updated_at: string | null;
}

type DurationUnit = 'minutes' | 'hours';
type FormValues = Record<'enabled' | 'amount' | 'unit', string>;

// Mirrors the server's ceiling (`apps/api/src/routes/settings.ts`,
// `CHAT_TIMEOUT_MAX_SECONDS`): a window longer than 30 days is
// indistinguishable from "off" but still a number the sweep would act on.
const MAX_SECONDS = 2_592_000;
const UNIT_SECONDS: Record<DurationUnit, number> = { minutes: 60, hours: 3600 };
const DEFAULT_AMOUNT = 30;

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

  const save = useMutation({
    mutationFn: (body: { chat_timeout_seconds: number | null }) =>
      api.put<ChatTimeoutSettings>('/settings/chat-timeout', body),
    onSuccess: onSaved,
  });

  const form = useForm<FormValues>({
    initial: {
      enabled: String(config.chat_timeout_seconds !== null),
      amount: draft.amount,
      unit: draft.unit,
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
      try {
        await save.mutateAsync({
          chat_timeout_seconds:
            values.enabled === 'true'
              ? Number(values.amount) * UNIT_SECONDS[values.unit as DurationUnit]
              : null,
        });
      } catch (error_) {
        setSubmitError(t(errorMessageKey(error_)));
      }
    },
  });

  const durationError = amountError(t, form.values);
  const enabled = form.values.enabled === 'true';

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

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!form.isDirty || form.isSubmitting || durationError !== null}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting ? t('settings.saving') : t('settings.save')}
          </button>

          {form.submitError && (
            <p role="alert" className="text-2xs text-danger">
              {form.submitError}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
