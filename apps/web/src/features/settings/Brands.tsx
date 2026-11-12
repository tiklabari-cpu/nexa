/**
 * Brands (Multibrand, PRD §5.3) — the brand catalogue, not what a brand
 * contains. A license may run several brands under one subscription; each has
 * its own channels, websites and widget/security/inbox settings, selected
 * elsewhere via the `X-SiyahTus-Brand` header. This screen only manages the
 * catalogue itself: list, add, rename, remove, and each brand's logo address
 * (WG-10) — the image the widget heads its panel with when Widget appearance ›
 * "Show the brand logo" is on. The `Default` brand every license is created
 * with can be renamed but never removed — the license always needs exactly
 * one default to fall back to.
 *
 * The logo is a link, not an upload (there is no logo upload endpoint): only
 * an https address without a user name or password, checked with the same
 * `brandLogoUrl` the API's `logo_url` rule and the widget mint use, so the
 * form never accepts an address the server refuses or the widget would not
 * draw.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { brandLogoUrl } from '@siyahtus/types';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { useConfirm } from '../../components/ui/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, optional, required, useForm, type Validator } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_default: boolean;
  created_at: string;
}

/** The logo address rule as a form validator: `brandLogoUrl`, or the message. */
function logoAddress(message: string): Validator {
  return (value) => (brandLogoUrl(value) ? null : message);
}

/** A small preview of a stored logo; an empty frame when there is none or it fails to load. */
function LogoThumbnail({ src, alt }: { src: string | null; alt: string }): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <span
        aria-hidden="true"
        className="h-8 w-8 shrink-0 rounded-md border border-dashed border-border bg-inset"
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(src)}
      className="h-8 w-8 shrink-0 rounded-md border border-border bg-inset object-contain"
    />
  );
}

export function Brands({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: Brand[] }>('/brands'),
  });

  const invalidate = (): void =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'brands'] });

  const add = useMutation({
    mutationFn: (body: { name: string; logo_url?: string }) => api.post<Brand>('/brands', body),
    onSuccess: invalidate,
  });

  // A name is required, Submit disabled until it is present (FR-EK-A.1); a
  // logo is optional, but when given it must be one the API accepts.
  const form = useForm({
    initial: { name: '', logo_url: '' },
    validators: {
      name: required(t('settings.brands.nameError')),
      logo_url: optional(logoAddress(t('settings.brands.logoError'))),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      const logo = brandLogoUrl(values.logo_url);
      try {
        await add.mutateAsync({ name: values.name.trim(), ...(logo ? { logo_url: logo } : {}) });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  useSettingsLeaveGuard(form.isDirty, form.isSubmitting);
  const nameError = form.errorFor('name');
  const newLogoError = form.errorFor('logo_url');

  return (
    <Section title={t('settings.brands.title')} description={t('settings.brands.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.brands.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-start gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-brand-name" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.brands.nameLabel')}
                </span>
                <input
                  id="new-brand-name"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.blur('name')}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'new-brand-name-error' : undefined}
                  placeholder={t('settings.brands.namePlaceholder')}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="new-brand-name-error" message={nameError} />
              </label>

              <div className="flex min-w-56 flex-1 flex-col gap-1">
                <label
                  htmlFor="new-brand-logo"
                  className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                >
                  {t('settings.brands.logoLabel')}
                </label>
                <input
                  id="new-brand-logo"
                  type="url"
                  inputMode="url"
                  value={form.values.logo_url}
                  onChange={(event) => form.setValue('logo_url', event.target.value)}
                  onBlur={() => form.blur('logo_url')}
                  aria-invalid={newLogoError ? true : undefined}
                  aria-describedby={newLogoError ? 'new-brand-logo-error' : 'new-brand-logo-hint'}
                  placeholder="https://"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                {newLogoError ? (
                  <FieldError id="new-brand-logo-error" message={newLogoError} />
                ) : (
                  <p id="new-brand-logo-hint" className="text-2xs text-content-tertiary">
                    {t('settings.brands.logoHint')}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? t('settings.adding') : t('settings.brands.addButton')}
              </button>

              {form.submitError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.brands.empty.title')}
              description={t('settings.brands.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((brand) => (
                <BrandRow key={brand.id} brand={brand} canEdit={canEdit} onChanged={invalidate} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

/**
 * One row: an inline-editable name (saved on blur, PATCH) and, for every
 * brand but the default, a Remove button. The default has none — it is the
 * license's fallback and cannot be deleted — and any server rejection (a slug
 * clash on rename, or a brand still holding data on remove) surfaces here
 * rather than at the top of the screen, next to the row it is about.
 */
function BrandRow({
  brand,
  canEdit,
  onChanged,
}: {
  brand: Brand;
  canEdit: boolean;
  onChanged: () => void;
}): ReactElement {
  const t = useTranslate();
  const { confirm, dialog } = useConfirm();
  const api = useApiClient();
  const [name, setName] = useState(brand.name);
  const [logo, setLogo] = useState(brand.logo_url ?? '');
  const [logoError, setLogoError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (nextName: string) => api.patch<Brand>(`/brands/${brand.id}`, { name: nextName }),
    onSuccess: onChanged,
    onError: () => setName(brand.name),
  });

  const updateLogo = useMutation({
    mutationFn: (next: string | null) =>
      api.patch<Brand>(`/brands/${brand.id}`, { logo_url: next }),
    onSuccess: (updated) => {
      setLogo(updated.logo_url ?? '');
      onChanged();
    },
    onError: () => setLogo(brand.logo_url ?? ''),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/brands/${brand.id}`),
    onSuccess: onChanged,
  });

  function save(): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === brand.name) {
      setName(brand.name);
      return;
    }
    rename.mutate(trimmed);
  }

  // Saved on blur like the name. Empty clears the logo; an address the API
  // would refuse stays in the field with the reason under it and is never sent.
  function saveLogo(): void {
    const trimmed = logo.trim();
    const href = trimmed === '' ? null : brandLogoUrl(trimmed);
    if (trimmed !== '' && href === null) {
      setLogoError(t('settings.brands.logoError'));
      return;
    }
    setLogoError(null);
    if (href === (brand.logo_url ?? null)) {
      setLogo(brand.logo_url ?? '');
      return;
    }
    updateLogo.mutate(href);
  }

  const error = rename.error ?? updateLogo.error ?? remove.error;
  const logoFieldId = `brand-logo-${brand.id}`;

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-3">
        <label htmlFor={`brand-name-${brand.id}`} className="sr-only">
          {t('settings.brands.nameFieldAriaLabel', { name: brand.name })}
        </label>
        <input
          id={`brand-name-${brand.id}`}
          value={name}
          disabled={!canEdit || rename.isPending}
          onChange={(event) => setName(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(brand.name);
          }}
          className="flex-1 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-70"
        />

        {brand.is_default && (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-content-tertiary">
            {t('settings.brands.default')}
          </span>
        )}

        {canEdit && !brand.is_default && (
          <button
            type="button"
            onClick={() =>
              confirm({
                title: t('settings.brands.removeConfirmTitle', { name: brand.name }),
                description: t('settings.brands.removeConfirmDescription'),
                confirmLabel: t('settings.remove'),
                onConfirm: () => remove.mutateAsync(),
              })
            }
            disabled={remove.isPending}
            aria-label={t('settings.brands.removeAriaLabel', { name: brand.name })}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {t('settings.remove')}
          </button>
        )}
      </div>

      <div className="flex items-start gap-3">
        <LogoThumbnail
          src={brandLogoUrl(brand.logo_url)}
          alt={t('settings.brands.logoPreviewAlt', { name: brand.name })}
        />
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={logoFieldId} className="sr-only">
            {t('settings.brands.logoFieldAriaLabel', { name: brand.name })}
          </label>
          <input
            id={logoFieldId}
            type="url"
            inputMode="url"
            value={logo}
            disabled={!canEdit || updateLogo.isPending}
            onChange={(event) => {
              setLogo(event.target.value);
              setLogoError(null);
            }}
            onBlur={saveLogo}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              if (event.key === 'Escape') {
                setLogo(brand.logo_url ?? '');
                setLogoError(null);
              }
            }}
            aria-invalid={logoError ? true : undefined}
            aria-describedby={logoError ? `${logoFieldId}-error` : undefined}
            placeholder={t('settings.brands.logoRowPlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary disabled:opacity-70"
          />
          <FieldError id={`${logoFieldId}-error`} message={logoError} />
        </div>
      </div>

      {error && <ErrorNotice message={t(errorMessageKey(error))} />}
      {dialog}
    </li>
  );
}
