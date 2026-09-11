/**
 * Settings → Data retention (NFR-C8).
 *
 * How long this workspace keeps its conversations and its visitor telemetry
 * before the sweep hard-deletes them. A pure consumer of
 * `GET`/`PATCH /settings/retention`; every rule it shows is the server's word.
 *
 * Three things are on the screen because the endpoint returns three, and the
 * third is the one that makes the other two honest: the **choice**, the
 * deployment **default** it inherits when no choice has been made, and the
 * **effective** window the sweep will actually apply. They differ whenever a
 * signed BAA caps the choice (NFR-C4 · C4-e), and an admin asking "when will
 * this conversation be deleted" needs the third number, not the first.
 *
 * The ceiling is read from `max_*_days` rather than derived from
 * `hipaa_scope` here. Deriving it would put a second copy of the HIPAA rule in
 * the console, free to disagree with the endpoint about which options to offer
 * — the mistake `Compliance.tsx` avoids by reading `baa_available` instead of
 * comparing `region` to `'us'`.
 *
 * Role gate mirrors the routes' `minimumRole: 'admin'`, the courtesy hide
 * `Compliance`/`SiemExport`/`AuditLog` all use: whoever cannot read this is not
 * shown a door that only leads to a 403.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { RETENTION_TIERS, type RetentionTier } from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface RetentionSettings {
  thread_window: RetentionTier | null;
  visit_window: RetentionTier | null;
  default_thread_days: number;
  default_visit_days: number;
  effective_thread_days: number | null;
  effective_visit_days: number | null;
  max_thread_days: number | null;
  max_visit_days: number | null;
  hipaa_scope: boolean;
}

/** The empty option's value — a `<select>` cannot carry `null`. */
const INHERIT = '';

type FormValues = Record<'thread' | 'visit', string>;

const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

/** Days a tier names, for deciding whether a ceiling puts it out of reach. */
const TIER_DAYS: Record<RetentionTier, number | null> = {
  '30d': 30,
  '60d': 60,
  '365d': 365,
  unlimited: null,
};

/**
 * Whether a tier is selectable given the ceiling in force.
 *
 * `unlimited` is unreachable under any ceiling, not merely a long one:
 * indefinite retention is what the agreement exists to prevent, so it is not a
 * value that can be made shorter.
 */
function tierAllowed(tier: RetentionTier, maxDays: number | null): boolean {
  if (maxDays === null) return true;
  const days = TIER_DAYS[tier];
  return days !== null && days <= maxDays;
}

function tierLabel(t: TFunction, tier: RetentionTier): string {
  return t(`settings.retention.tier.${tier}`);
}

function toTier(value: string): RetentionTier | null {
  return value === INHERIT ? null : (value as RetentionTier);
}

export function DataRetention({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !VIEWER_ROLES.has(role)) return null;
  return <RetentionCard canEdit={canEdit} />;
}

function RetentionCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'retention'],
    queryFn: () => api.get<RetentionSettings>('/settings/retention'),
  });

  return (
    <Section
      id="section-data-retention"
      title={t('settings.retention.title')}
      description={t('settings.retention.description')}
    >
      {settings.error ? (
        <ErrorNotice message={t('settings.retention.loadError')} />
      ) : (
        <Card>
          {settings.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <RetentionForm
              settings={settings.data}
              canEdit={canEdit}
              onSaved={(data) => queryClient.setQueryData(['settings', 'retention'], data)}
            />
          )}
        </Card>
      )}
    </Section>
  );
}

/**
 * Mounted only once the settings have loaded, so `useForm`'s `initial` is the
 * saved choice on the first render rather than a default racing a fetch —
 * `ChatTimeoutForm`'s reasoning, and the same failure it avoids (a form that
 * looks dirty before anybody touched it).
 */
function RetentionForm({
  settings,
  canEdit,
  onSaved,
}: {
  settings: RetentionSettings;
  canEdit: boolean;
  onSaved: (data: RetentionSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (body: {
      thread_window: RetentionTier | null;
      visit_window: RetentionTier | null;
    }) => api.patch<RetentionSettings>('/settings/retention', body),
    onSuccess: onSaved,
  });

  const form = useForm<FormValues>({
    initial: {
      thread: settings.thread_window ?? INHERIT,
      visit: settings.visit_window ?? INHERIT,
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        // Both windows every time, because both are on the screen: a partial
        // body would be the right shape for a single-field editor and the wrong
        // one here, where the person just read and confirmed the pair.
        await save.mutateAsync({
          thread_window: toTier(values.thread),
          visit_window: toTier(values.visit),
        });
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      {settings.hipaa_scope && (
        <p className="text-2xs text-content-tertiary">
          {t('settings.retention.hipaaNote', { days: String(settings.max_thread_days ?? '') })}
        </p>
      )}

      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <WindowField
          id="retention-thread"
          label={t('settings.retention.threadLabel')}
          hint={t('settings.retention.threadHint')}
          value={form.values.thread}
          maxDays={settings.max_thread_days}
          defaultDays={settings.default_thread_days}
          effectiveDays={settings.effective_thread_days}
          onChange={(value) => form.setValue('thread', value)}
        />
        <WindowField
          id="retention-visit"
          label={t('settings.retention.visitLabel')}
          hint={t('settings.retention.visitHint')}
          value={form.values.visit}
          maxDays={settings.max_visit_days}
          defaultDays={settings.default_visit_days}
          effectiveDays={settings.effective_visit_days}
          onChange={(value) => form.setValue('visit', value)}
        />
      </fieldset>

      <p className="text-2xs text-content-tertiary">{t('settings.retention.auditNote')}</p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!form.isDirty || form.isSubmitting}
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

function WindowField({
  id,
  label,
  hint,
  value,
  maxDays,
  defaultDays,
  effectiveDays,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  maxDays: number | null;
  defaultDays: number;
  effectiveDays: number | null;
  onChange: (value: string) => void;
}): ReactElement {
  const t = useTranslate();

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-56 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
      >
        <option value={INHERIT}>
          {t('settings.retention.inherit', { days: String(defaultDays) })}
        </option>
        {RETENTION_TIERS.filter((tier) => tierAllowed(tier, maxDays)).map((tier) => (
          <option key={tier} value={tier}>
            {tierLabel(t, tier)}
          </option>
        ))}
      </select>
      <span className="text-2xs text-content-tertiary">{hint}</span>
      {/* The number that actually decides, stated separately from the choice —
          they are the same until a ceiling cuts the choice back, and that is
          exactly when somebody needs to see both. */}
      <span className="text-2xs text-content-secondary">
        {effectiveDays === null
          ? t('settings.retention.effectiveUnlimited')
          : t('settings.retention.effectiveDays', { days: String(effectiveDays) })}
      </span>
    </div>
  );
}
