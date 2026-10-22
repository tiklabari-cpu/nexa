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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { RETENTION_TIERS, type RetentionTier } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
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

/** The draft: a tier per window, `null` for the deployment default. */
interface Draft {
  thread_window: RetentionTier | null;
  visit_window: RetentionTier | null;
}

/**
 * A high-risk setting (GV-06-S1 · tm 323.2): how long the workspace keeps
 * people's conversations. Save shows the before/after of each window and asks
 * why; the reason travels with the PATCH and the API writes it to the audit
 * entry beside the tiers.
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

  const saved: Draft = {
    thread_window: settings.thread_window,
    visit_window: settings.visit_window,
  };
  const defaults: Record<keyof Draft, number> = {
    thread_window: settings.default_thread_days,
    visit_window: settings.default_visit_days,
  };

  const fields = (values: Draft, set: (key: keyof Draft, tier: RetentionTier | null) => void) => (
    <>
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
          value={values.thread_window ?? INHERIT}
          maxDays={settings.max_thread_days}
          defaultDays={settings.default_thread_days}
          effectiveDays={settings.effective_thread_days}
          onChange={(value) => set('thread_window', toTier(value))}
        />
        <WindowField
          id="retention-visit"
          label={t('settings.retention.visitLabel')}
          hint={t('settings.retention.visitHint')}
          value={values.visit_window ?? INHERIT}
          maxDays={settings.max_visit_days}
          defaultDays={settings.default_visit_days}
          effectiveDays={settings.effective_visit_days}
          onChange={(value) => set('visit_window', toTier(value))}
        />
      </fieldset>

      <p className="text-2xs text-content-tertiary">{t('settings.retention.auditNote')}</p>
    </>
  );

  if (!canEdit) {
    return <div className="flex flex-col gap-5 p-4">{fields(saved, () => undefined)}</div>;
  }

  return (
    <SettingsForm<Draft>
      saved={saved}
      label={t('settings.retention.title')}
      highRisk={{
        labels: {
          thread_window: t('settings.retention.threadLabel'),
          visit_window: t('settings.retention.visitLabel'),
        },
        format: (key, value) =>
          value === null
            ? t('settings.retention.inherit', { days: String(defaults[key]) })
            : tierLabel(t, value as RetentionTier),
      }}
      onSave={async (values, { reason }) => {
        // Both windows every time, because both are on the screen: a partial
        // body would be the right shape for a single-field editor and the wrong
        // one here, where the person just read and confirmed the pair.
        const data = await api.patch<RetentionSettings>('/settings/retention', {
          thread_window: values.thread_window,
          visit_window: values.visit_window,
          reason,
        });
        onSaved(data);
      }}
    >
      {(form) => (
        <div className="flex flex-col gap-5 p-4">
          {fields(form.values, (key, tier) => form.setValue(key, tier))}
        </div>
      )}
    </SettingsForm>
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
