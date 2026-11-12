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
 *   - **Operator-signed identity** (ID-03 · K28 · tm 388) — the switch, the
 *     secret the operator's server signs logged-in members with (issued and
 *     rotated here, shown exactly once), the last week's accepted and ignored
 *     signatures by reason, and what the operator's developer has to build.
 *
 * The key itself is never on the screen — the API describes it (version, age,
 * the previous version's deadline) and nothing else. The identity secret is on
 * it once, in the dialog that issues it; closing the dialog discards it. The
 * destructive buttons ask first (`useConfirm`) and keep their dialog open on a
 * refusal.
 *
 * Read-only for whoever lacks `access_rules:rw`: the same gate as every other
 * Security section, and the endpoints keep the real one (`minimumRole: admin`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  MEMBER_IDENTITY_SECRET_ROTATION_GRACE,
  MEMBER_KEY_ROTATION_GRACE,
  MEMBER_TOKEN_TTL,
  SIGNED_IDENTITY_LIMITS,
  SIGNED_IDENTITY_REFUSALS,
  type SecondsRange,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { useConfirm } from '../../components/ui/ConfirmDialog.js';
import { Modal } from '../../components/ui/index.js';
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

interface SignedIdentitySettings {
  enabled: boolean;
  /** On and a secret exists: identify calls are being verified. */
  active: boolean;
  /** Described like the key — never the secret. */
  secret: MemberKeyInfo | null;
  /** The last week's signed identities; null when the counters could not be read. */
  recent: { days: number; verified: number; refused: Record<string, number> } | null;
}

/** What the settings form sends: only the fields that changed. */
interface SettingsChange {
  token_ttl_seconds?: number;
  possible_matches_enabled?: boolean;
  signed_identity_enabled?: boolean;
}

interface MemberRecognitionSettings {
  token_ttl_seconds: number;
  possible_matches_enabled: boolean;
  key: MemberKeyInfo | null;
  tokens_revoked_before: string | null;
  signed_identity: SignedIdentitySettings;
  updated_at: string | null;
}

type TtlUnit = 'hours' | 'days';
type FormValues = Record<'amount' | 'unit' | 'matches' | 'signed', string>;

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
          <Card>
            <SignedIdentity config={settings.data} canEdit={canEdit} onChanged={onChanged} />
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
    mutationFn: (body: SettingsChange) =>
      api.patch<MemberRecognitionSettings>('/settings/member-recognition', body),
    onSuccess: onSaved,
  });

  const form = useForm<FormValues>({
    initial: {
      amount: draft.amount,
      unit: draft.unit,
      matches: String(config.possible_matches_enabled),
      signed: String(config.signed_identity.enabled),
    },
    // No per-field validator for the amount: its range depends on the unit,
    // which a single-field `Validator` cannot see (`ChatTimeout`'s reasoning).
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      const error = lifetimeError(t, values);
      if (error) {
        setFieldError('amount', error);
        return;
      }
      const body: SettingsChange = {};
      if (secondsOf(values) !== config.token_ttl_seconds) {
        body.token_ttl_seconds = secondsOf(values);
      }
      if ((values.matches === 'true') !== config.possible_matches_enabled) {
        body.possible_matches_enabled = values.matches === 'true';
      }
      if ((values.signed === 'true') !== config.signed_identity.enabled) {
        body.signed_identity_enabled = values.signed === 'true';
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

        {/* A workspace-wide security switch, so it waits for Save like the
            others (GV-06); the secret, its card below, is issued on its own. */}
        <label className="flex items-start gap-3 border-t border-border pt-5">
          <input
            type="checkbox"
            checked={form.values.signed === 'true'}
            onChange={(event) => form.setValue('signed', String(event.target.checked))}
          />
          <span className="text-sm">
            {t('settings.memberRecognition.identity.toggle')}
            <span className="block text-2xs text-content-tertiary">
              {t('settings.memberRecognition.identity.toggleHint')}
            </span>
          </span>
        </label>
      </fieldset>

      {canEdit && <FormSaveBar form={form} valid={ttlError === null} />}
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

/**
 * The exact message the operator's server signs — one line per field, the
 * version first and the time last (`signedIdentityMessage` in
 * `@siyahtus/types`). Code, so not translated.
 */
const MESSAGE_FORMAT = 'siyahtus-identify-v1\\n<user_id>\\n<username>\\n<email>\\n<ts>';

const NODE_EXAMPLE = `const crypto = require('node:crypto');

// On your server only. SIYAHTUS_IDENTITY_SECRET is the secret this screen showed you.
function siyahtusIdentity(user) {
  const id = String(user.id); // user_id is text, a numeric id too
  const ts = Math.floor(Date.now() / 1000);
  const message = ['siyahtus-identify-v1', id, user.username || '', user.email || '', String(ts)].join('\\n');
  const user_hash = crypto
    .createHmac('sha256', process.env.SIYAHTUS_IDENTITY_SECRET)
    .update(message)
    .digest('hex');
  return { user_id: id, username: user.username || '', email: user.email || '', ts, user_hash };
}`;

const PHP_EXAMPLE = `<?php
// On your server only. SIYAHTUS_IDENTITY_SECRET is the secret this screen showed you.
function siyahtus_identity(array $user): array {
    $id = (string) $user['id']; // user_id is text, a numeric id too
    $ts = time();
    $message = implode("\\n", ['siyahtus-identify-v1', $id, $user['username'] ?? '', $user['email'] ?? '', (string) $ts]);
    $hash = hash_hmac('sha256', $message, getenv('SIYAHTUS_IDENTITY_SECRET'));
    return ['user_id' => $id, 'username' => $user['username'] ?? '', 'email' => $user['email'] ?? '', 'ts' => $ts, 'user_hash' => $hash];
}`;

const PAGE_EXAMPLE = `<script>
  window.addEventListener('load', function () {
    siyahtus('identify', <?= json_encode(siyahtus_identity($user), JSON_HEX_TAG | JSON_HEX_AMP) ?>);
  });
</script>`;

/**
 * Operator-signed identity (ID-03 · K28 · tm 388): what the switch means now,
 * the secret — issued, described, rotated with a grace window, shown once —
 * the last week's signatures, and what the operator's developer builds. The
 * switch itself is the form's above: a workspace security setting waits for
 * Save (GV-06). On without a secret still verifies nothing, as the status says.
 */
function SignedIdentity({
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
  const [grace, setGrace] = useState(
    String(days(MEMBER_IDENTITY_SECRET_ROTATION_GRACE.defaultSeconds)),
  );
  const [revealed, setRevealed] = useState<string | null>(null);
  const identity = config.signed_identity;
  const secret = identity.secret;

  const issue = useMutation({
    mutationFn: (graceDays: number) =>
      api.post<MemberRecognitionSettings & { identity_secret: string }>(
        '/settings/member-recognition/identity-secret',
        { grace_period_seconds: graceDays * UNIT_SECONDS.days },
      ),
    onSuccess: ({ identity_secret, ...view }) => {
      onChanged(view);
      setRevealed(identity_secret);
    },
  });

  const error = secret ? graceError(t, grace, MEMBER_IDENTITY_SECRET_ROTATION_GRACE) : null;
  const status = identity.active
    ? t('settings.memberRecognition.identity.statusActive')
    : identity.enabled
      ? t('settings.memberRecognition.identity.statusNoSecret')
      : t('settings.memberRecognition.identity.statusOff');

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-sm font-medium">{t('settings.memberRecognition.identity.heading')}</h3>
        <p className="text-2xs text-content-tertiary">
          {t('settings.memberRecognition.identity.hint')}
        </p>
      </div>

      <p data-testid="signed-identity-status" className="text-sm text-content-secondary">
        {status}
      </p>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h4 className="text-xs font-medium">
          {t('settings.memberRecognition.identity.secretHeading')}
        </h4>
        {secret ? (
          // Labels of its own, not the signing key's: the two cards sit on one
          // screen and describe different keys.
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-content-tertiary">
              {t('settings.memberRecognition.identity.secretVersion')}
            </dt>
            <dd>{secret.version}</dd>
            <dt className="text-content-tertiary">
              {t('settings.memberRecognition.identity.secretCreated')}
            </dt>
            <dd>{formatDateTime(secret.created_at)}</dd>
            {secret.previous_version !== null && secret.previous_valid_until !== null && (
              <>
                <dt className="text-content-tertiary">
                  {t('settings.memberRecognition.identity.previous')}
                </dt>
                <dd>
                  {t('settings.memberRecognition.identity.previousUntil', {
                    version: secret.previous_version,
                    date: formatDateTime(secret.previous_valid_until) ?? '',
                  })}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-content-secondary">
            {t('settings.memberRecognition.identity.secretNone')}
          </p>
        )}
        <p role="note" className="text-2xs text-warning">
          {t('settings.memberRecognition.identity.browserWarning')}
        </p>

        {canEdit && (
          <div className="flex flex-col gap-3">
            {secret && (
              <>
                <div className="flex w-48 flex-col gap-1">
                  <label
                    htmlFor="member-identity-grace"
                    className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                  >
                    {t('settings.memberRecognition.identity.graceLabel')}
                  </label>
                  <input
                    id="member-identity-grace"
                    type="number"
                    min={days(MEMBER_IDENTITY_SECRET_ROTATION_GRACE.minSeconds)}
                    max={days(MEMBER_IDENTITY_SECRET_ROTATION_GRACE.maxSeconds)}
                    value={grace}
                    onChange={(event) => setGrace(event.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby="member-identity-grace-hint"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  />
                </div>
                {error ? (
                  <FieldError id="member-identity-grace-hint" message={error} />
                ) : (
                  <p id="member-identity-grace-hint" className="text-2xs text-content-tertiary">
                    {Number(grace) === 0
                      ? t('settings.memberRecognition.identity.graceNone')
                      : t('settings.memberRecognition.identity.graceHint', {
                          count: Number(grace),
                        })}
                  </p>
                )}
              </>
            )}
            <div>
              <button
                type="button"
                disabled={error !== null || issue.isPending}
                onClick={() =>
                  secret
                    ? confirm({
                        title: t('settings.memberRecognition.identity.rotateConfirmTitle'),
                        description:
                          Number(grace) === 0
                            ? t('settings.memberRecognition.identity.rotateConfirmNone')
                            : t('settings.memberRecognition.identity.rotateConfirmGrace', {
                                count: Number(grace),
                              }),
                        confirmLabel: t('settings.memberRecognition.identity.rotateConfirm'),
                        failureTitle: t('settings.memberRecognition.identity.issueFailure'),
                        onConfirm: () => issue.mutateAsync(Number(grace)),
                      })
                    : void issue.mutateAsync(0).catch(() => undefined)
                }
                className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {secret
                  ? t('settings.memberRecognition.identity.rotateButton')
                  : t('settings.memberRecognition.identity.issueButton')}
              </button>
            </div>
            {!secret && issue.isError && (
              <p role="alert" className="text-2xs text-danger">
                {t('settings.memberRecognition.identity.issueFailure')}
              </p>
            )}
          </div>
        )}
      </div>

      <RecentSignatures recent={identity.recent} />
      <IdentityDeveloperNotes />
      {revealed && <IdentitySecretPanel secret={revealed} onClose={() => setRevealed(null)} />}
      {dialog}
    </div>
  );
}

/** The last week's signed identities: how many verified, and why the others were ignored. */
function RecentSignatures({ recent }: { recent: SignedIdentitySettings['recent'] }): ReactElement {
  const t = useTranslate();
  if (!recent) {
    return (
      <p className="text-2xs text-content-tertiary">
        {t('settings.memberRecognition.identity.recentUnavailable')}
      </p>
    );
  }
  const refused = SIGNED_IDENTITY_REFUSALS.filter((reason) => (recent.refused[reason] ?? 0) > 0);
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-4">
      <h4 className="text-xs font-medium">
        {t('settings.memberRecognition.identity.recentHeading', { days: recent.days })}
      </h4>
      <p className="text-sm" data-testid="signed-identity-verified">
        {t('settings.memberRecognition.identity.recentVerified', { count: recent.verified })}
      </p>
      {refused.length === 0 ? (
        <p className="text-2xs text-content-tertiary">
          {t('settings.memberRecognition.identity.recentNoneRefused')}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-2xs text-content-secondary">
          {refused.map((reason) => (
            <li key={reason}>
              {t(`settings.memberRecognition.identity.reason.${reason}`)}:{' '}
              <span className="tabular">{recent.refused[reason]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the operator's developer builds: the message, the clock rule, two examples, the warning. */
function IdentityDeveloperNotes(): ReactElement {
  const t = useTranslate();
  return (
    <details className="rounded-md border border-border p-3 text-xs">
      <summary className="cursor-pointer font-medium">
        {t('settings.memberRecognition.identity.dev.title')}
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-content-secondary">
        <li>{t('settings.memberRecognition.identity.dev.server')}</li>
        <li>
          {t('settings.memberRecognition.identity.dev.message')}{' '}
          <code className="break-all rounded-sm bg-inset px-1">{MESSAGE_FORMAT}</code>
        </li>
        <li>
          {t('settings.memberRecognition.identity.dev.clock', {
            minutes: SIGNED_IDENTITY_LIMITS.maxAgeSeconds / 60,
          })}
        </li>
        <li>{t('settings.memberRecognition.identity.dev.page')}</li>
        <li>{t('settings.memberRecognition.identity.dev.logout')}</li>
      </ol>
      <p className="mt-2 font-medium">Node.js</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-inset p-2 text-2xs">{NODE_EXAMPLE}</pre>
      <p className="mt-2 font-medium">PHP</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-inset p-2 text-2xs">{PHP_EXAMPLE}</pre>
      <pre className="mt-1 overflow-x-auto rounded-md bg-inset p-2 text-2xs">{PAGE_EXAMPLE}</pre>
    </details>
  );
}

/** The secret, once — closing the dialog is what discards it from the screen's state. */
function IdentitySecretPanel({
  secret,
  onClose,
}: {
  secret: string;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(secret).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };
  return (
    <Modal
      onClose={onClose}
      title={t('settings.memberRecognition.identity.secretTitle')}
      description={t('settings.memberRecognition.identity.secretDescription')}
      className="w-[32rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <code
            data-testid="member-identity-secret"
            className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs"
          >
            {secret}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={t('settings.memberRecognition.identity.copyAriaLabel')}
            className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {copied ? t('settings.copied') : t('settings.copy')}
          </button>
        </div>
        <p role="alert" className="text-2xs text-warning">
          {t('settings.memberRecognition.identity.browserWarning')}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.memberRecognition.identity.secretDone')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
