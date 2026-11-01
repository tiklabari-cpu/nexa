/**
 * Billing details — who the workspace is on its invoices (tm 383 · BL-02).
 *
 * The owner writes them (`PUT /billing/profile`, K7), admins and the vice
 * owner read them; anyone below admin never asks (the route would 403). Each
 * invoice copies the details when it is issued, so the form says that saving
 * changes the next invoice, not the ones already issued.
 *
 * Without details an invoice is still issued — under the workspace name — and
 * a band asks for them. The tax-number rules are `billingProfileProblem`
 * from @siyahtus/types, the same function the API checks with, so the form
 * never refuses what the server would accept or the reverse.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import {
  billingProfileProblem,
  BILLING_PROFILE_LIMITS,
  normaliseTaxId,
  normaliseVatId,
  roleAtLeast,
  type AgentRole,
  type BillingProfile,
  type BillingProfileProblem,
} from '@siyahtus/types';
import { Card, CardSkeleton, ErrorNotice, Section } from '../../components/Page.js';
import { Banner } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { COUNTRY_CODES, countryName } from '../../lib/countries.js';
import { FieldError, useForm } from '../../lib/form.js';
import { useLocale, useTranslate, type TFunction } from '../../lib/i18n.js';

type FieldName =
  | 'legal_name'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'postal_code'
  | 'country'
  | 'tax_office'
  | 'tax_id'
  | 'vat_id'
  | 'invoice_email';

type ProfileValues = Record<FieldName, string>;

const PROBLEM_KEYS: Record<BillingProfileProblem, string> = {
  country_invalid: 'billing.profile.error.country',
  tax_id_invalid: 'billing.profile.error.taxIdInvalid',
  tax_id_required: 'billing.profile.error.taxIdRequired',
  vat_id_invalid: 'billing.profile.error.vatId',
  invoice_email_invalid: 'billing.profile.error.email',
};

const FIELD_LABEL_KEYS: Record<FieldName, string> = {
  legal_name: 'billing.profile.field.legalName',
  address_line1: 'billing.profile.field.addressLine1',
  address_line2: 'billing.profile.field.addressLine2',
  city: 'billing.profile.field.city',
  postal_code: 'billing.profile.field.postalCode',
  country: 'billing.profile.field.country',
  tax_office: 'billing.profile.field.taxOffice',
  tax_id: 'billing.profile.field.taxId',
  vat_id: 'billing.profile.field.vatId',
  invoice_email: 'billing.profile.field.invoiceEmail',
};

/** The rule a whole set of values breaks, checked the way the API checks it. */
function problemFor(
  values: ProfileValues,
): { field: FieldName; problem: BillingProfileProblem } | null {
  const taxId = values.tax_id.trim();
  const vatId = values.vat_id.trim();
  const found = billingProfileProblem({
    country: values.country.trim().toUpperCase(),
    tax_id: taxId === '' ? null : normaliseTaxId(taxId),
    vat_id: vatId === '' ? null : normaliseVatId(vatId),
    invoice_email: values.invoice_email.trim() === '' ? null : values.invoice_email.trim(),
  });
  return found ? { field: found.field as FieldName, problem: found.problem } : null;
}

function requiredText(t: TFunction, max: number) {
  return (value: string): string | null => {
    if (value.trim() === '') return t('billing.profile.error.required');
    if (value.trim().length > max) return t('billing.profile.error.tooLong', { max });
    return null;
  };
}

function optionalText(t: TFunction, max: number) {
  return (value: string): string | null =>
    value.trim().length > max ? t('billing.profile.error.tooLong', { max }) : null;
}

export function BillingProfileSection({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const role = useAuth((s) => s.agent?.role) as AgentRole | undefined;
  const canRead = role !== undefined && roleAtLeast(role, 'admin');
  const [editing, setEditing] = useState(false);

  const query = useQuery({
    queryKey: ['billing', 'profile'],
    queryFn: () => api.get<{ profile: BillingProfile | null }>('/billing/profile'),
    enabled: canRead,
  });

  const save = useMutation({
    mutationFn: (body: Record<FieldName, string | null>) =>
      api.put<{ profile: BillingProfile }>('/billing/profile', body),
    onSuccess: (saved) => {
      queryClient.setQueryData(['billing', 'profile'], { profile: saved.profile });
      setEditing(false);
    },
  });

  if (!canRead) return null;

  const title = t('billing.profile.title');
  const description = t('billing.profile.description');

  if (query.isPending) {
    return (
      <Section title={title} description={description}>
        <CardSkeleton rows={2} />
      </Section>
    );
  }
  if (query.error) {
    return (
      <Section title={title} description={description}>
        <ErrorNotice message={t('billing.profile.loadError')} />
      </Section>
    );
  }

  const profile = query.data.profile;

  return (
    <Section title={title} description={description}>
      {!profile && (
        <div className="mb-3">
          <Banner tone="warning" title={t('billing.profile.missing.title')}>
            {canEdit ? t('billing.profile.missing.owner') : t('billing.profile.missing.reader')}
          </Banner>
        </div>
      )}
      <Card>
        <div className="flex flex-col gap-4 p-4">
          {profile && !editing && <ProfileSummary profile={profile} />}
          {editing ? (
            <ProfileForm
              profile={profile}
              pending={save.isPending}
              onCancel={() => {
                save.reset();
                setEditing(false);
              }}
              onSubmit={(body, helpers) =>
                save.mutateAsync(body).then(
                  () => undefined,
                  (error: unknown) => {
                    const details = error instanceof ApiClientError ? error.details : undefined;
                    const field = details?.['field'];
                    const reason = details?.['reason'];
                    if (typeof field === 'string' && field in FIELD_LABEL_KEYS) {
                      const key =
                        typeof reason === 'string' && reason in PROBLEM_KEYS
                          ? PROBLEM_KEYS[reason as BillingProfileProblem]
                          : 'billing.profile.error.invalid';
                      helpers.setFieldError(field as FieldName, t(key));
                    } else {
                      helpers.setSubmitError(t('billing.profile.saveError'));
                    }
                  },
                )
              }
            />
          ) : canEdit ? (
            <div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                {profile ? t('billing.profile.editButton') : t('billing.profile.addButton')}
              </button>
            </div>
          ) : null}
        </div>
      </Card>
    </Section>
  );
}

function ProfileSummary({ profile }: { profile: BillingProfile }): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const rows: [string, string | null][] = [
    [t('billing.profile.field.legalName'), profile.legal_name],
    [
      t('billing.profile.summary.address'),
      [
        profile.address_line1,
        profile.address_line2,
        [profile.postal_code, profile.city].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', '),
    ],
    [
      t('billing.profile.field.country'),
      `${countryName(profile.country, locale)} (${profile.country})`,
    ],
    [t('billing.profile.field.taxOffice'), profile.tax_office],
    [t('billing.profile.field.taxId'), profile.tax_id],
    [t('billing.profile.field.vatId'), profile.vat_id],
    [t('billing.profile.field.invoiceEmail'), profile.invoice_email],
  ];
  return (
    <dl
      data-testid="billing-profile"
      className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2"
    >
      {rows
        .filter((row): row is [string, string] => Boolean(row[1]))
        .map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-2xs text-content-tertiary">{label}</dt>
            <dd className="text-content-primary">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function ProfileForm({
  profile,
  pending,
  onCancel,
  onSubmit,
}: {
  profile: BillingProfile | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (
    body: Record<FieldName, string | null>,
    helpers: {
      setFieldError: (name: FieldName, message: string | null) => void;
      setSubmitError: (message: string | null) => void;
    },
  ) => Promise<void>;
}): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const L = BILLING_PROFILE_LIMITS;

  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale),
      ),
    [locale],
  );

  const form = useForm<ProfileValues>({
    initial: {
      legal_name: profile?.legal_name ?? '',
      address_line1: profile?.address_line1 ?? '',
      address_line2: profile?.address_line2 ?? '',
      city: profile?.city ?? '',
      postal_code: profile?.postal_code ?? '',
      country: profile?.country ?? '',
      tax_office: profile?.tax_office ?? '',
      tax_id: profile?.tax_id ?? '',
      vat_id: profile?.vat_id ?? '',
      invoice_email: profile?.invoice_email ?? '',
    },
    validators: {
      legal_name: requiredText(t, L.legalName),
      address_line1: requiredText(t, L.addressLine),
      address_line2: optionalText(t, L.addressLine),
      city: requiredText(t, L.city),
      postal_code: optionalText(t, L.postalCode),
      country: (value) => (value === '' ? t('billing.profile.error.required') : null),
      tax_office: optionalText(t, L.taxOffice),
      tax_id: optionalText(t, L.taxId + 16),
      vat_id: optionalText(t, L.vatId + 8),
      invoice_email: optionalText(t, L.invoiceEmail),
    },
    onSubmit: (values, helpers) => {
      // The rules that read more than one field (a Turkish tax number, the VAT
      // prefix, the e-mail) — refused here exactly as the API would refuse them.
      const problem = problemFor(values);
      if (problem) {
        helpers.setFieldError(problem.field, t(PROBLEM_KEYS[problem.problem]));
        return;
      }
      const blank = (value: string) => (value.trim() === '' ? null : value.trim());
      return onSubmit(
        {
          legal_name: values.legal_name.trim(),
          address_line1: values.address_line1.trim(),
          address_line2: blank(values.address_line2),
          city: values.city.trim(),
          postal_code: blank(values.postal_code),
          country: values.country,
          tax_office: blank(values.tax_office),
          tax_id: blank(values.tax_id),
          vat_id: blank(values.vat_id),
          invoice_email: blank(values.invoice_email),
        },
        helpers,
      );
    },
  });

  /** Leaving a field checks the cross-field rule that names it. */
  const leave = (name: FieldName) => {
    form.blur(name);
    const problem = problemFor(form.values);
    if (problem?.field === name) form.setFieldError(name, t(PROBLEM_KEYS[problem.problem]));
  };

  const field = 'rounded-md border border-border bg-inset px-3 py-2 text-sm';

  const text = (name: FieldName, options: { type?: string; hint?: string } = {}) => {
    const id = `bp-${name}`;
    const error = form.errorFor(name);
    const hintId = options.hint ? `${id}-hint` : undefined;
    const describedBy = [error ? `${id}-error` : null, hintId].filter(Boolean).join(' ');
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-2xs font-medium text-content-secondary">
          {t(FIELD_LABEL_KEYS[name])}
        </label>
        <input
          id={id}
          type={options.type ?? 'text'}
          value={form.values[name]}
          onChange={(e) => form.setValue(name, e.target.value)}
          onBlur={() => leave(name)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={field}
        />
        {options.hint && (
          <p id={hintId} className="text-2xs text-content-tertiary">
            {options.hint}
          </p>
        )}
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  };

  const countryError = form.errorFor('country');

  return (
    <form
      data-testid="billing-profile-form"
      onSubmit={form.handleSubmit}
      noValidate
      role="group"
      aria-label={t('billing.profile.title')}
      className="flex flex-col gap-3"
    >
      <p className="text-2xs text-content-tertiary">{t('billing.profile.form.snapshotNotice')}</p>
      {text('legal_name')}
      {text('address_line1')}
      {text('address_line2')}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text('postal_code')}
        {text('city')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="bp-country" className="text-2xs font-medium text-content-secondary">
          {t('billing.profile.field.country')}
        </label>
        <select
          id="bp-country"
          value={form.values.country}
          onChange={(e) => {
            form.setValue('country', e.target.value);
            // Whether a tax number is valid depends on the country.
            form.setFieldError('tax_id', null);
          }}
          onBlur={() => leave('country')}
          aria-invalid={countryError ? true : undefined}
          aria-describedby={countryError ? 'bp-country-error' : undefined}
          className={field}
        >
          <option value="">{t('billing.profile.form.chooseCountry')}</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        <FieldError id="bp-country-error" message={countryError} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text('tax_office')}
        {text('tax_id', { hint: t('billing.profile.form.taxIdHint') })}
      </div>
      {text('vat_id', { hint: t('billing.profile.form.vatIdHint') })}
      {text('invoice_email', { type: 'email' })}

      {form.submitError && <ErrorNotice message={form.submitError} />}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!form.canSubmit || pending}
          className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
        >
          {pending ? t('billing.profile.form.saving') : t('billing.profile.form.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-content-secondary hover:bg-surface-2"
        >
          {t('billing.profile.form.cancel')}
        </button>
      </div>
    </form>
  );
}
