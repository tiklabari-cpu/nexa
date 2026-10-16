/**
 * Settings › Security › Member recognition (SiyahTuş analysis ID-03 · owner
 * decision K4 · tm 287.5) — the screen of the four doors `routes/member-
 * recognition.ts` opened in tm 287.2.
 *
 * A returning visitor is recognised by a member token the server signs; this is
 * where an administrator steers that:
 *
 *   - **How long a visitor is remembered** — the token's lifetime *without a
 *     visit* (it is re-signed on every visit, so a regular never expires). A
 *     whole number of hours or days, at least a day and at most a year; the
 *     bounds are the shared `MEMBER_TOKEN_TTL`, the same the endpoint and the
 *     database CHECK read.
 *   - **Possible matches** — whether agents are shown other records with the
 *     same pre-chat username or e-mail. The hint says what the list is: a
 *     suggestion marked unverified, joined only by an agent's confirmation.
 *   - **Signing key rotation** — with a grace window (0 to 30 days) in which the
 *     members the old key signed are still recognised and re-signed. `0` is the
 *     emergency rotation, which the confirmation says out loud: every member
 *     starts again as a new visitor.
 *   - **Forget every returning visitor** — the bulk revocation. Nothing is
 *     deleted and nobody is banned; every browser becomes a new visitor.
 *
 * The key itself is never on the screen — the API describes it (version, age,
 * the previous version's deadline) and nothing else. The two destructive
 * buttons ask first (`useConfirm`) and keep their dialog open on a refusal.
 *
 * Read-only for whoever lacks `access_rules:rw`: the same gate as every other
 * Security section, and the endpoints keep the real one (`minimumRole: admin`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { MEMBER_KEY_ROTATION_GRACE, MEMBER_TOKEN_TTL, type SecondsRange } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useConfirm } from '../../components/ui/ConfirmDialog.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm } from '../../lib/form.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface MemberKeyInfo {
  version: number;
  created_at: string;
  previous_version: number | null;
  previous_valid_until: string | null;
}

interface MemberRecognitionSettings {
  token_ttl_seconds: number;
  possible_matches_enabled: boolean;
  key: MemberKeyInfo | null;
  tokens_revoked_before: string | null;
  updated_at: string | null;
}

type TtlUnit = 'hours' | 'days';
type FormValues = Record<'amount' | 'unit' | 'matches', string>;

const UNIT_SECONDS: Record<TtlUnit, number> = { hours: 3600, days: 86_400 };
const QUERY_KEY = ['settings', 'member-recognition'] as const;

/** Whole days when the saved lifetime is a whole number of them, else hours. */
function draftFromSeconds(seconds: number): { amount: string; unit: TtlUnit } {
  if (seconds % UNIT_SECONDS.days === 0) {
    return { amount: String(seconds / UNIT_SECONDS.days), unit: 'days' };
  }
  return { amount: String(Math.max(1, Math.round(seconds / UNIT_SECONDS.hours))), unit: 'hours' };
}

function secondsOf(values: Pick<FormValues, 'amount' | 'unit'>): number {
  return Number(values.amount) * UNIT_SECONDS[values.unit === 'hours' ? 'hours' : 'days'];
}

function lifetimeError(t: TFunction, values: FormValues): string | null {
  const amount = Number(values.amount);
  if (values.amount.trim() === '' || !Number.isInteger(amount) || amount <= 0) {
    return t('settings.memberRecognition.ttlError');
  }
  const seconds = secondsOf(values);
  return seconds >= MEMBER_TOKEN_TTL.minSeconds && seconds <= MEMBER_TOKEN_TTL.maxSeconds
    ? null
    : t('settings.memberRecognition.ttlError');
}

/** Whole days of a range's bound; the grace window is picked in days. */
const days = (seconds: number): number => seconds / UNIT_SECONDS.days;

function graceError(t: TFunction, value: string, range: SecondsRange): string | null {
  const amount = Number(value);
  const ok =
    value.trim() !== '' &&
    Number.isInteger(amount) &&
    amount >= days(range.minSeconds) &&
    amount <= days(range.maxSeconds);
  return ok
    ? null
    : t('settings.memberRecognition.graceError', {
        min: days(range.minSeconds),
        max: days(range.maxSeconds),
      });
}

export function MemberRecognition({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<MemberRecognitionSettings>('/settings/member-recognition'),
  });

  if (settings.error) return <ErrorNotice message={t('settings.memberRecognition.loadError')} />;

  const onChanged = (data: MemberRecognitionSettings): void => {
    queryClient.setQueryData(QUERY_KEY, data);
  };

  return (
    <Section
      id="section-member-recognition"
      title={t('settings.memberRecognition.title')}
      description={t('settings.memberRecognition.description')}
    >
      {settings.isPending ? (
        <Card>
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <RecognitionForm config={settings.data} canEdit={canEdit} onSaved={onChanged} />
          </Card>
          <Card>
            <SigningKey config={settings.data} canEdit={canEdit} onChanged={onChanged} />
          </Card>
          <Card>
            <ForgetAll config={settings.data} canEdit={canEdit} onChanged={onChanged} />
          </Card>
        </div>
      )}
    </Section>
  );
}

/**
 * Mounted once the saved values have loaded, so `useForm`'s `initial` is real
 * (the `ChatTimeout` reasoning). Only the fields that changed are sent, so a
 * switch-only save does not read as a lifetime change in the audit trail.
 */
function RecognitionForm({
  config,
  canEdit,
  onSaved,
}: {
  config: MemberRecognitionSettings;
  canEdit: boolean;
  onSaved: (data: MemberRecognitionSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const draft = draftFromSeconds(config.token_ttl_seconds);

  const save = useMutation({
    mutationFn: (body: { token_ttl_seconds?: number; possible_matches_enabled?: boolean }) =>
      api.patch<MemberRecognitionSettings>('/settings/member-recognition', body),
    onSuccess: onSaved,
  });

  const form = useForm<FormValues>({
    initial: {
      amount: draft.amount,
      unit: draft.unit,
      matches: String(config.possible_matches_enabled),
    },
    // No per-field validator for the amount: its range depends on the unit,
    // which a single-field `Validator` cannot see (`ChatTimeout`'s reasoning).
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      const error = lifetimeError(t, values);
      if (error) {
        setFieldError('amount', error);
        return;
      }
      const body: { token_ttl_seconds?: number; possible_matches_enabled?: boolean } = {};
      if (secondsOf(values) !== config.token_ttl_seconds) {
        body.token_ttl_seconds = secondsOf(values);
      }
      if ((values.matches === 'true') !== config.possible_matches_enabled) {
        body.possible_matches_enabled = values.matches === 'true';
      }
      // Nothing to send: the unit was switched back to what it was.
      if (Object.keys(body).length === 0) return;
      try {
        await save.mutateAsync(body);
      } catch (error_) {
        setSubmitError(t(errorMessageKey(error_)));
      }
    },
  });

  const ttlError = lifetimeError(t, form.values);

  function validateAmount(): void {
    form.setFieldError('amount', lifetimeError(t, form.values));
  }

  function setUnit(unit: TtlUnit): void {
    const next = { ...form.values, unit };
    form.setValue('unit', unit);
    form.setFieldError('amount', lifetimeError(t, next));
  }

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <div>
          <h3 className="text-sm font-medium">{t('settings.memberRecognition.ttlHeading')}</h3>
          <p className="text-2xs text-content-tertiary">
            {t('settings.memberRecognition.ttlHint')}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-32 flex-col gap-1">
            <label
              htmlFor="member-recognition-amount"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.memberRecognition.amountLabel')}
            </label>
            <input
              id="member-recognition-amount"
              type="number"
              min={1}
              value={form.values.amount}
              onChange={(event) => form.setValue('amount', event.target.value)}
              onBlur={validateAmount}
              aria-invalid={ttlError ? true : undefined}
              aria-describedby={ttlError ? 'member-recognition-amount-error' : undefined}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            />
          </div>
          <div className="flex w-32 flex-col gap-1">
            <label
              htmlFor="member-recognition-unit"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.memberRecognition.unitLabel')}
            </label>
            <select
              id="member-recognition-unit"
              value={form.values.unit}
              onChange={(event) => setUnit(event.target.value as TtlUnit)}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            >
              <option value="days">{t('settings.memberRecognition.unitDays')}</option>
              <option value="hours">{t('settings.memberRecognition.unitHours')}</option>
            </select>
          </div>
        </div>
        <FieldError id="member-recognition-amount-error" message={ttlError} />
        <p className="text-2xs text-content-tertiary">
          {t('settings.memberRecognition.ttlBounds', {
            min: days(MEMBER_TOKEN_TTL.minSeconds),
            max: days(MEMBER_TOKEN_TTL.maxSeconds),
          })}
        </p>

        <label className="flex items-start gap-3 border-t border-border pt-5">
          <input
            type="checkbox"
            checked={form.values.matches === 'true'}
            onChange={(event) => form.setValue('matches', String(event.target.checked))}
          />
          <span className="text-sm">
            {t('settings.memberRecognition.matchesLabel')}
            <span className="block text-2xs text-content-tertiary">
              {t('settings.memberRecognition.matchesHint')}
            </span>
          </span>
        </label>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!form.isDirty || form.isSubmitting || ttlError !== null}
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

/**
 * The key, described — never shown. Rotating asks first, because a rotation
 * with a zero grace window forgets every member who has not visited since.
 */
function SigningKey({
  config,
  canEdit,
  onChanged,
}: {
  config: MemberRecognitionSettings;
  canEdit: boolean;
  onChanged: (data: MemberRecognitionSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const { confirm, dialog } = useConfirm();
  const [grace, setGrace] = useState(String(days(MEMBER_KEY_ROTATION_GRACE.defaultSeconds)));

  const rotate = useMutation({
    mutationFn: (graceDays: number) =>
      api.post<MemberRecognitionSettings>('/settings/member-recognition/rotate-key', {
        grace_period_seconds: graceDays * UNIT_SECONDS.days,
      }),
    onSuccess: onChanged,
  });

  const error = graceError(t, grace, MEMBER_KEY_ROTATION_GRACE);
  const key = config.key;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-sm font-medium">{t('settings.memberRecognition.keyHeading')}</h3>
        <p className="text-2xs text-content-tertiary">{t('settings.memberRecognition.keyHint')}</p>
      </div>

      {key ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-content-tertiary">{t('settings.memberRecognition.keyVersion')}</dt>
          <dd>{key.version}</dd>
          <dt className="text-content-tertiary">{t('settings.memberRecognition.keyCreated')}</dt>
          <dd>{formatDateTime(key.created_at)}</dd>
          {key.previous_version !== null && key.previous_valid_until !== null && (
            <>
              <dt className="text-content-tertiary">
                {t('settings.memberRecognition.keyPrevious')}
              </dt>
              <dd>
                {t('settings.memberRecognition.keyPreviousUntil', {
                  version: key.previous_version,
                  date: formatDateTime(key.previous_valid_until) ?? '',
                })}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-content-secondary">{t('settings.memberRecognition.keyNone')}</p>
      )}

      {canEdit && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex w-48 flex-col gap-1">
            <label
              htmlFor="member-recognition-grace"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.memberRecognition.graceLabel')}
            </label>
            <input
              id="member-recognition-grace"
              type="number"
              min={days(MEMBER_KEY_ROTATION_GRACE.minSeconds)}
              max={days(MEMBER_KEY_ROTATION_GRACE.maxSeconds)}
              value={grace}
              onChange={(event) => setGrace(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby="member-recognition-grace-hint"
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
            />
          </div>
          {error ? (
            <FieldError id="member-recognition-grace-hint" message={error} />
          ) : (
            <p id="member-recognition-grace-hint" className="text-2xs text-content-tertiary">
              {Number(grace) === 0
                ? t('settings.memberRecognition.graceNone')
                : t('settings.memberRecognition.graceHint', { count: Number(grace) })}
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={error !== null || rotate.isPending}
              onClick={() =>
                confirm({
                  title: t('settings.memberRecognition.rotateConfirmTitle'),
                  description:
                    Number(grace) === 0
                      ? t('settings.memberRecognition.rotateConfirmNone')
                      : t('settings.memberRecognition.rotateConfirmGrace', {
                          count: Number(grace),
                        }),
                  confirmLabel: t('settings.memberRecognition.rotateConfirm'),
                  failureTitle: t('settings.memberRecognition.rotateFailure'),
                  onConfirm: () => rotate.mutateAsync(Number(grace)),
                })
              }
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {t('settings.memberRecognition.rotateButton')}
            </button>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

/** The bulk revocation: every returning visitor starts again as a new one. */
function ForgetAll({
  config,
  canEdit,
  onChanged,
}: {
  config: MemberRecognitionSettings;
  canEdit: boolean;
  onChanged: (data: MemberRecognitionSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const { confirm, dialog } = useConfirm();

  const revoke = useMutation({
    mutationFn: () =>
      api.post<MemberRecognitionSettings>('/settings/member-recognition/revoke-all'),
    onSuccess: onChanged,
  });

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-medium">{t('settings.memberRecognition.forgetHeading')}</h3>
        <p className="text-2xs text-content-tertiary">
          {t('settings.memberRecognition.forgetHint')}
        </p>
      </div>
      {config.tokens_revoked_before && (
        <p role="status" className="text-sm text-content-secondary">
          {t('settings.memberRecognition.forgetLast', {
            date: formatDateTime(config.tokens_revoked_before) ?? '',
          })}
        </p>
      )}
      {canEdit && (
        <div>
          <button
            type="button"
            disabled={revoke.isPending}
            onClick={() =>
              confirm({
                title: t('settings.memberRecognition.forgetConfirmTitle'),
                description: t('settings.memberRecognition.forgetConfirmDescription'),
                confirmLabel: t('settings.memberRecognition.forgetConfirm'),
                failureTitle: t('settings.memberRecognition.forgetFailure'),
                onConfirm: () => revoke.mutateAsync(),
              })
            }
            className="rounded-md border border-danger px-3 py-1.5 text-sm text-danger transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {t('settings.memberRecognition.forgetButton')}
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}
