/**
 * Billing › Payment settings (tm 389.18 · FR-ADMIN-14): the three settings every workspace's
 * billing screen reads — which payment methods are offered, the bank account the SWIFT screen
 * shows, and the issuer every new statement carries.
 *
 * Each form saves through a reason dialog (the platform audit chain names the fields that
 * changed, never their values). A method switched off stops new payments by it; payments already
 * paid, references already issued and statements already issued stay as they are.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/Banner.js';
import { ApiClientError } from '../../lib/api-client.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { FIELD_CLASS, Loading, PRIMARY_BUTTON_CLASS } from '../workspaces/ui.js';
import {
  useBankDetails,
  useIssuerProfile,
  useProviders,
  useSaveBankDetails,
  useSaveIssuerProfile,
  useSaveProviders,
} from './payment-queries.js';

const METHODS = ['swift_manual', 'crypto_manual', 'stripe'] as const;
type Method = (typeof METHODS)[number];

function describeSettingsError(t: TFunction) {
  return (error: unknown): string | null => {
    if (!(error instanceof ApiClientError)) return null;
    const reason = error.details?.['reason'];
    return reason === 'iban_invalid' || reason === 'swift_bic_invalid'
      ? t(`billing.settings.error.${reason}`)
      : null;
  };
}

export function PaymentSettings(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'billing.manage');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {notice && (
        <Banner tone="success" role="status" dismissible onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      <ProvidersSection
        canManage={canManage}
        onSaved={() => setNotice(t('billing.settings.saved'))}
      />
      <BankSection canManage={canManage} onSaved={() => setNotice(t('billing.settings.saved'))} />
      <IssuerSection canManage={canManage} onSaved={() => setNotice(t('billing.settings.saved'))} />
    </div>
  );
}

function Section({
  id,
  title,
  description,
  updatedAt,
  children,
}: {
  id: string;
  title: string;
  description: string;
  updatedAt: string | null | undefined;
  children: ReactNode;
}): ReactElement {
  const t = useTranslate();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-1 text-sm font-semibold">
        {title}
      </h2>
      <p className="mb-3 text-xs text-content-secondary">
        {description}{' '}
        {updatedAt
          ? t('billing.settings.updatedAt', { date: formatDate(updatedAt) ?? '' })
          : t('billing.settings.never')}
      </p>
      <Card>{children}</Card>
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  hint?: string;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className={FIELD_CLASS}
        value={value}
        disabled={disabled}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-content-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

function SaveRow({
  canManage,
  dirty,
  disabled = false,
  onSave,
}: {
  canManage: boolean;
  dirty: boolean;
  disabled?: boolean;
  onSave: () => void;
}): ReactElement | null {
  const t = useTranslate();
  if (!canManage) return null;
  return (
    <div className="flex justify-end border-t border-border p-4">
      <button
        type="button"
        className={PRIMARY_BUTTON_CLASS}
        disabled={!dirty || disabled}
        onClick={onSave}
      >
        {t('billing.settings.save')}
      </button>
    </div>
  );
}

// --- Methods ---------------------------------------------------------------------

function ProvidersSection({
  canManage,
  onSaved,
}: {
  canManage: boolean;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const query = useProviders();
  const save = useSaveProviders();
  const [draft, setDraft] = useState<Record<Method, boolean> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const stored = query.data?.providers;
  useEffect(() => {
    if (stored) setDraft({ ...stored });
  }, [stored]);
  const dirty = Boolean(stored && draft && METHODS.some((id) => stored[id] !== draft[id]));

  return (
    <Section
      id="billing-providers"
      title={t('billing.settings.providers.title')}
      description={t('billing.settings.providers.body')}
      updatedAt={query.data?.updated_at}
    >
      {query.isPending || !draft ? (
        query.isError ? (
          <LoadError
            title={t('billing.settings.failed')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <Loading label={t('billing.loading')} />
        )
      ) : (
        <>
          <fieldset className="space-y-3 p-4">
            <legend className="sr-only">{t('billing.settings.providers.title')}</legend>
            {METHODS.map((id) => (
              <div key={id} className="flex items-start gap-2">
                <input
                  id={`billing-provider-${id}`}
                  type="checkbox"
                  className="mt-1"
                  checked={draft[id]}
                  disabled={!canManage}
                  onChange={(event) => setDraft({ ...draft, [id]: event.target.checked })}
                />
                <label htmlFor={`billing-provider-${id}`} className="text-sm">
                  <span className="font-medium">{t(`billing.settings.method.${id}`)}</span>
                  {id === 'stripe' && query.data?.stripe_card_ready === false && (
                    <span className="block text-xs text-content-secondary">
                      {t('billing.settings.providers.stripeNotReady')}
                    </span>
                  )}
                </label>
              </div>
            ))}
          </fieldset>
          <SaveRow canManage={canManage} dirty={dirty} onSave={() => setConfirming(true)} />
        </>
      )}
      {confirming && draft && (
        <ReasonDialog
          title={t('billing.settings.providers.confirmTitle')}
          description={t('billing.settings.providers.confirmBody')}
          confirmLabel={t('billing.settings.save')}
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            onSaved();
          }}
          onConfirm={({ reason }) => save.mutateAsync({ ...draft, reason })}
        />
      )}
    </Section>
  );
}

// --- Bank account ------------------------------------------------------------------

const EMPTY_BANK = { beneficiary: '', bank_name: '', iban: '', swift_bic: '', bank_address: '' };

function BankSection({
  canManage,
  onSaved,
}: {
  canManage: boolean;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const query = useBankDetails();
  const save = useSaveBankDetails();
  const [draft, setDraft] = useState(EMPTY_BANK);
  const [confirming, setConfirming] = useState(false);
  const details = query.data?.details;
  const initial = details ? { ...details, bank_address: details.bank_address ?? '' } : EMPTY_BANK;
  useEffect(() => {
    if (query.data) setDraft(initial);
    // `initial` is derived from `query.data`; re-running on it alone is the intent.
  }, [query.data]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const complete =
    draft.beneficiary.trim() !== '' &&
    draft.bank_name.trim() !== '' &&
    draft.iban.trim() !== '' &&
    draft.swift_bic.trim() !== '';
  const field = (key: keyof typeof EMPTY_BANK, hint?: string) => (
    <TextField
      id={`billing-bank-${key}`}
      label={t(`billing.settings.bank.${key}`)}
      value={draft[key]}
      disabled={!canManage}
      {...(hint ? { hint } : {})}
      onChange={(value) => setDraft({ ...draft, [key]: value })}
    />
  );

  return (
    <Section
      id="billing-bank"
      title={t('billing.settings.bank.title')}
      description={t('billing.settings.bank.body')}
      updatedAt={query.data?.updated_at}
    >
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.settings.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {field('beneficiary')}
            {field('bank_name')}
            {field('iban', t('billing.settings.bank.ibanHint'))}
            {field('swift_bic', t('billing.settings.bank.bicHint'))}
            <div className="sm:col-span-2">{field('bank_address')}</div>
          </div>
          <SaveRow
            canManage={canManage}
            dirty={dirty}
            disabled={!complete}
            onSave={() => setConfirming(true)}
          />
        </>
      )}
      {confirming && (
        <ReasonDialog
          title={t('billing.settings.bank.confirmTitle')}
          description={t('billing.settings.bank.confirmBody')}
          confirmLabel={t('billing.settings.save')}
          describeError={describeSettingsError(t)}
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            onSaved();
          }}
          onConfirm={({ reason }) =>
            save.mutateAsync({
              beneficiary: draft.beneficiary.trim(),
              bank_name: draft.bank_name.trim(),
              iban: draft.iban,
              swift_bic: draft.swift_bic,
              bank_address: draft.bank_address.trim() || null,
              reason,
            })
          }
        />
      )}
    </Section>
  );
}

// --- Issuer --------------------------------------------------------------------------

const EMPTY_ISSUER = {
  legal_name: '',
  address: '',
  country: '',
  tax_office: '',
  tax_id: '',
  vat_id: '',
  email: '',
  tax_note: '',
};
type IssuerDraft = typeof EMPTY_ISSUER;

function IssuerSection({
  canManage,
  onSaved,
}: {
  canManage: boolean;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const query = useIssuerProfile();
  const save = useSaveIssuerProfile();
  const [draft, setDraft] = useState<IssuerDraft>(EMPTY_ISSUER);
  const [confirming, setConfirming] = useState(false);
  const profile = query.data?.profile;
  const initial: IssuerDraft = profile
    ? {
        legal_name: profile.legal_name,
        address: profile.address_lines.join('\n'),
        country: profile.country ?? '',
        tax_office: profile.tax_office ?? '',
        tax_id: profile.tax_id ?? '',
        vat_id: profile.vat_id ?? '',
        email: profile.email ?? '',
        tax_note: profile.tax_note ?? '',
      }
    : EMPTY_ISSUER;
  useEffect(() => {
    if (query.data) setDraft(initial);
    // `initial` is derived from `query.data`; re-running on it alone is the intent.
  }, [query.data]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const countryOk = draft.country.trim() === '' || /^[A-Za-z]{2}$/.test(draft.country.trim());
  const valid = draft.legal_name.trim() !== '' && countryOk;
  const field = (key: Exclude<keyof IssuerDraft, 'address' | 'tax_note'>, hint?: string) => (
    <TextField
      id={`billing-issuer-${key}`}
      label={t(`billing.settings.issuer.${key}`)}
      value={draft[key]}
      disabled={!canManage}
      {...(hint ? { hint } : {})}
      onChange={(value) => setDraft({ ...draft, [key]: value })}
    />
  );
  const area = (key: 'address' | 'tax_note', hint: string) => (
    <div className="sm:col-span-2">
      <label htmlFor={`billing-issuer-${key}`} className="text-sm font-medium">
        {t(`billing.settings.issuer.${key}`)}
      </label>
      <textarea
        id={`billing-issuer-${key}`}
        className={FIELD_CLASS}
        rows={3}
        value={draft[key]}
        disabled={!canManage}
        aria-describedby={`billing-issuer-${key}-hint`}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
      <p id={`billing-issuer-${key}-hint`} className="mt-1 text-xs text-content-secondary">
        {hint}
      </p>
    </div>
  );
  const optional = (value: string) => value.trim() || null;

  return (
    <Section
      id="billing-issuer"
      title={t('billing.settings.issuer.title')}
      description={t('billing.settings.issuer.body')}
      updatedAt={query.data?.updated_at}
    >
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.settings.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {!profile && (
            <p className="px-4 pt-4 text-sm text-content-secondary">
              {t('billing.settings.issuer.placeholder')}
            </p>
          )}
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {field('legal_name')}
            {field('country', t('billing.settings.issuer.countryHint'))}
            {area('address', t('billing.settings.issuer.addressHint'))}
            {field('tax_office')}
            {field('tax_id')}
            {field('vat_id')}
            {field('email')}
            {area('tax_note', t('billing.settings.issuer.taxNoteHint'))}
          </div>
          <SaveRow
            canManage={canManage}
            dirty={dirty}
            disabled={!valid}
            onSave={() => setConfirming(true)}
          />
        </>
      )}
      {confirming && (
        <ReasonDialog
          title={t('billing.settings.issuer.confirmTitle')}
          description={t('billing.settings.issuer.confirmBody')}
          confirmLabel={t('billing.settings.save')}
          onCancel={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            onSaved();
          }}
          onConfirm={({ reason }) =>
            save.mutateAsync({
              legal_name: draft.legal_name.trim(),
              address_lines: draft.address
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 6),
              country: optional(draft.country)?.toUpperCase() ?? null,
              tax_office: optional(draft.tax_office),
              tax_id: optional(draft.tax_id),
              vat_id: optional(draft.vat_id),
              email: optional(draft.email),
              tax_note: optional(draft.tax_note),
              reason,
            })
          }
        />
      )}
    </Section>
  );
}
