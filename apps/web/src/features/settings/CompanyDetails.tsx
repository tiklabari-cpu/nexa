/**
 * Settings → Company details (FR-MOD-08.3 · M-CO-b).
 *
 * A pure consumer of `GET|PATCH /settings/company`, which M-CO-a (tm 182.1)
 * already built and owns: the workspace's name, sector, address and timezone —
 * PRD §8.4's billing/branding/report basis. This screen opens no new server
 * surface, and every rule it applies is one the endpoint applies too (the
 * closed `COMPANY_SECTORS` list, the 500-character address bound, an IANA zone
 * name) so a value that passes here cannot be refused there.
 *
 * **One gate, not two.** Other sections take `canEdit` and still render
 * read-only for someone who may look but not change. There is no such person
 * here: `organization--my:rw` is the only scope on this surface — the read has
 * no `:ro` counterpart — and both routes also carry `minimumRole: 'admin'`. So
 * the section hides entirely rather than showing a door that only leads to a
 * 403, the courtesy hide `Compliance`/`SiemExport`/`AuditLog` use, and the prop
 * is named `canManage` to say that reading and writing are the same permission.
 * The routes stay the real boundary.
 *
 * ## The timezone decision (the task's actual question)
 *
 * Two columns in this schema carry a zone — `organizations.timezone` and
 * `work_schedules.timezone` — and the second one predates the first. Left
 * unrelated they would be two sources of truth for the same fact, which is the
 * failure mode worth naming precisely: an admin moves the workspace to
 * `Europe/Istanbul`, every agent's schedule editor still opens at `UTC`, and
 * the 09:00-18:00 week the new hire saves is really 12:00-21:00 local. Nothing
 * errors. The staffing forecast and the business-hours SLA clock just quietly
 * measure a different day than the one anyone meant.
 *
 * The resolution is **the company zone is authoritative and the agent zone is
 * an override of it**, not a peer:
 *
 *  - `GET /agents/{id}/work-schedule` seeds the unset case from
 *    `organizations.timezone` instead of `DEFAULT_WORK_SCHEDULE`'s hard-coded
 *    `UTC` (`routes/agents.ts` `serialiseWorkSchedule`). That is where the
 *    "which feeds which" question is actually answered, and where it is tested
 *    (`test/integration/work-schedule.test.ts`).
 *  - `work_schedules.timezone` is **kept**. Deleting it would make one zone
 *    per workspace mandatory, and a live-support roster spanning countries is
 *    the ordinary case, not the exotic one — an override is the feature, and
 *    the same column would have had to come back. (CONVENTIONS §6.3 forbids
 *    dropping a still-read column in one release regardless.)
 *  - Changing the company zone **does not rewrite saved schedules**. Those
 *    hours were chosen against a stated clock; re-pointing them silently would
 *    move a real shift by the offset between the two zones. The save note below
 *    says so and links to where they are edited, so the consequence is stated
 *    rather than discovered.
 *
 * Boundary worth stating: report *day buckets* are still cut on UTC midnight
 * (`services/reports/report-csv.ts`), not on this zone. That is a separate
 * decision with its own blast radius across every by-day report, and pretending
 * this screen changed it would be worse than saying it did not.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  COMPANY_ADDRESS_MAX_LENGTH,
  COMPANY_SECTORS,
  type CompanySector,
  type CompanyDetails as CompanyDetailsValue,
} from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, compose, maxLength, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { IANA_TIMEZONES } from '../../lib/timezones.js';

/** Mirrors both routes' `minimumRole: 'admin'` — the set `Compliance`/`SiemExport` use. */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

/** Mirrors the endpoint's `name` bound (`z.string().trim().min(1).max(200)`). */
const NAME_MAX_LENGTH = 200;

/** The form's four fields, all strings — `''` is how "not set" is spelled. */
type FormValues = Record<'name' | 'sector' | 'address' | 'timezone', string>;

function sectorLabel(t: TFunction, sector: CompanySector): string {
  return t(`settings.company.sector.${sector}`);
}

export function CompanyDetails({ canManage }: { canManage: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (!canManage || role === null || !VIEWER_ROLES.has(role)) return null;
  return <CompanyDetailsSection />;
}

function CompanyDetailsSection(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const company = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => api.get<CompanyDetailsValue>('/settings/company'),
  });

  if (company.error) return <ErrorNotice message={t('settings.company.loadError')} />;

  return (
    <Section
      id="section-company"
      title={t('settings.company.title')}
      description={t('settings.company.description')}
    >
      <Card>
        {company.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <CompanyDetailsForm
            company={company.data}
            onSaved={(data) => queryClient.setQueryData(['settings', 'company'], data)}
          />
        )}
      </Card>
    </Section>
  );
}

function initialValues(company: CompanyDetailsValue): FormValues {
  return {
    name: company.name,
    sector: company.sector ?? '',
    address: company.address ?? '',
    timezone: company.timezone,
  };
}

/**
 * Mounted only once the server's values have loaded, so `useForm`'s `initial`
 * is the real saved state on the very first render — `useForm` seeds once, at
 * mount, and does not resync when a prop changes later (`SlaPolicyForm`'s
 * precedent).
 */
function CompanyDetailsForm({
  company,
  onSaved,
}: {
  company: CompanyDetailsValue;
  onSaved: (data: CompanyDetailsValue) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (body: Partial<CompanyDetailsValue>) =>
      api.patch<CompanyDetailsValue>('/settings/company', body),
    onSuccess: onSaved,
  });

  const initial = initialValues(company);

  const form = useForm<FormValues>({
    initial,
    validators: {
      name: compose(
        required(t('settings.company.nameRequiredError')),
        maxLength(NAME_MAX_LENGTH, t('settings.company.nameTooLongError')),
      ),
      address: maxLength(
        COMPANY_ADDRESS_MAX_LENGTH,
        t('settings.company.addressTooLongError', { max: COMPANY_ADDRESS_MAX_LENGTH }),
      ),
    },
    onSubmit: async (values, { setSubmitError }) => {
      // Only what changed. The endpoint is a patch, Submit is disabled unless
      // something is dirty (so the body is never empty), and its audit entry
      // records the *field names* of the write — sending all four every time
      // would file "name, sector, address, timezone changed" for someone who
      // corrected a postcode.
      const body: Partial<CompanyDetailsValue> = {};
      if (values.name !== initial.name) body.name = values.name.trim();
      if (values.sector !== initial.sector) {
        body.sector = values.sector === '' ? null : (values.sector as CompanySector);
      }
      if (values.address !== initial.address) {
        body.address = values.address.trim() === '' ? null : values.address.trim();
      }
      if (values.timezone !== initial.timezone) body.timezone = values.timezone;

      try {
        await save.mutateAsync(body);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const nameError = form.errorFor('name');
  const addressError = form.errorFor('address');
  // Only while the current values are exactly what the last successful save
  // wrote — editing again clears it, so the note never sits over a later change.
  const justSavedTimezone =
    save.isSuccess && !form.isDirty && save.variables?.timezone !== undefined;

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <div className="flex flex-wrap gap-4">
        <div className="flex w-72 flex-col gap-1">
          <label
            htmlFor="company-name"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.company.nameLabel')}
          </label>
          <input
            id="company-name"
            type="text"
            maxLength={NAME_MAX_LENGTH}
            value={form.values.name}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.blur('name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'company-name-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <FieldError id="company-name-error" message={nameError} />
        </div>

        <div className="flex w-72 flex-col gap-1">
          <label
            htmlFor="company-sector"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.company.sectorLabel')}
          </label>
          <select
            id="company-sector"
            value={form.values.sector}
            onChange={(event) => form.setValue('sector', event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            <option value="">{t('settings.company.sectorUnset')}</option>
            {COMPANY_SECTORS.map((sector) => (
              <option key={sector} value={sector}>
                {sectorLabel(t, sector)}
              </option>
            ))}
          </select>
          <p className="text-2xs text-content-tertiary">{t('settings.company.sectorHint')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="company-address"
          className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
        >
          {t('settings.company.addressLabel')}
        </label>
        <textarea
          id="company-address"
          rows={3}
          maxLength={COMPANY_ADDRESS_MAX_LENGTH}
          placeholder={t('settings.company.addressPlaceholder')}
          value={form.values.address}
          onChange={(event) => form.setValue('address', event.target.value)}
          onBlur={() => form.blur('address')}
          aria-invalid={addressError ? true : undefined}
          aria-describedby={addressError ? 'company-address-error' : undefined}
          className="max-w-xl rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
        />
        <FieldError id="company-address-error" message={addressError} />
      </div>

      <div className="flex w-72 flex-col gap-1">
        <label
          htmlFor="company-timezone"
          className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
        >
          {t('settings.company.timezoneLabel')}
        </label>
        <select
          id="company-timezone"
          value={form.values.timezone}
          onChange={(event) => form.setValue('timezone', event.target.value)}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
        >
          {/* A zone stored before this list could express it stays selectable,
              so opening the form can never silently change what is saved. */}
          {!IANA_TIMEZONES.includes(form.values.timezone) && (
            <option value={form.values.timezone}>{form.values.timezone}</option>
          )}
          {IANA_TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        {/* Underlined always, not only on hover: axe rule `link-in-text-block`
            (serious) refuses a link that a colour change alone distinguishes
            from the sentence around it, and this one is always on screen —
            unlike `SlaPolicy`'s post-save note, which no scan ever sees. Its
            label deliberately omits the word "Team" too: `getByRole('link',
            {name})` matches on substring, so "Team → Work schedule" made every
            spec that clicks the rail's Team link from this page ambiguous. */}
        <p className="text-2xs text-content-tertiary">
          {t('settings.company.timezoneHintPrefix')}{' '}
          <Link to="/app/team" className="text-content-brand underline">
            {t('settings.company.timezoneHintLink')}
          </Link>
          {t('settings.company.timezoneHintSuffix')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!form.canSubmit || !form.isDirty}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {form.isSubmitting ? t('settings.saving') : t('settings.save')}
        </button>

        {form.submitError && (
          <p role="alert" className="text-2xs text-danger">
            {form.submitError}
          </p>
        )}

        {justSavedTimezone && (
          <p className="text-2xs text-content-tertiary">
            {t('settings.company.timezoneSavedNote')}
          </p>
        )}
      </div>
    </form>
  );
}
