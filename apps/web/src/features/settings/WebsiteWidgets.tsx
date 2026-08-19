/**
 * Website widgets — FR-MOD-08.5.2.
 *
 * Where an admin installs the chat widget on their sites: add a site, copy the
 * snippet (or mail it to a developer), and watch each row flip to Connected the
 * moment the widget first handshakes from that domain.
 *
 * One deliberate coupling: adding a website here also trusts its domain
 * (FR-MOD-08.9.1). A site and a trusted domain are stored separately — one is
 * the install record, the other the security allowlist — but making the admin
 * add the same domain in two places is exactly the "two disconnected lists"
 * this screen exists to avoid. So "Add website" does both, and the widget works
 * on the site the instant it is added.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { ApiClientError, errorMessageKey, type ApiClient } from '../../lib/api-client.js';
import { useApiClient, useBrand } from '../../lib/auth-store.js';
import { FieldError, compose, domain as domainRule, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

interface Website {
  id: string;
  domain: string;
  setup: 'manual' | 'platform';
  status: 'pending' | 'connected' | 'error';
  connected_at: string | null;
  created_at: string;
  snippet: string;
}

const STATUS_KEYS: Record<Website['status'], { tone: StatusTone; labelKey: string }> = {
  connected: { tone: 'success', labelKey: 'settings.websiteWidgets.status.connected' },
  pending: { tone: 'warning', labelKey: 'settings.websiteWidgets.status.pending' },
  error: { tone: 'danger', labelKey: 'settings.websiteWidgets.status.error' },
};

export function WebsiteWidgets({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { brandId } = useBrand();
  const [setup, setSetup] = useState<Website['setup']>('manual');
  const [openSnippet, setOpenSnippet] = useState<string | null>(null);

  // A brand switch means a different site list; a snippet panel left open
  // would otherwise keep pointing at a site id that belongs to the previous
  // brand.
  useEffect(() => setOpenSnippet(null), [brandId]);

  const list = useQuery({
    queryKey: ['settings', 'websites', brandId],
    queryFn: () => api.get<{ items: Website[] }>('/websites'),
    // The Connected transition is written server-side on the widget's first
    // handshake; polling reflects it without the admin refreshing the page.
    refetchInterval: 5_000,
  });

  // For the section title only — whose sites are listed.
  const brands = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>('/brands'),
    enabled: brandId !== null,
    staleTime: 60_000,
  });
  const brandName = brandId ? brands.data?.items.find((b) => b.id === brandId)?.name : undefined;

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'websites'] });
    // Adding a site also trusts its domain, so keep that list current too.
    void queryClient.invalidateQueries({ queryKey: ['settings', 'trusted-domains'] });
  };

  const add = useMutation({
    mutationFn: async (body: { domain: string; setup: Website['setup'] }) => {
      const website = await api.post<Website>('/websites', body);
      await trustDomain(api, body.domain);
      return website;
    },
    onSuccess: (website) => {
      setSetup('manual');
      setOpenSnippet(website.id); // reveal the snippet to paste straight away
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/websites/${id}`),
    onSuccess: invalidate,
  });

  // The one validation primitive owns "is this a domain?" and "may I submit?".
  const form = useForm({
    initial: { domain: '' },
    validators: {
      domain: compose(
        required(t('settings.websiteWidgets.domainRequiredError')),
        domainRule(t('settings.websiteWidgets.domainInvalidError')),
      ),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await add.mutateAsync({ domain: values.domain.trim(), setup });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const domainError = form.errorFor('domain');

  return (
    <Section
      id="section-website-widgets"
      title={
        brandName
          ? t('settings.websiteWidgets.titleWithBrand', { brand: brandName })
          : t('settings.websiteWidgets.title')
      }
      description={t('settings.websiteWidgets.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.websiteWidgets.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-website" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.websiteWidgets.domainLabel')}
                </span>
                <input
                  id="new-website"
                  value={form.values.domain}
                  onChange={(event) => form.setValue('domain', event.target.value)}
                  onBlur={() => form.blur('domain')}
                  aria-invalid={domainError ? true : undefined}
                  aria-describedby={domainError ? 'new-website-error' : undefined}
                  placeholder="shop.example"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="new-website-error" message={domainError} />
              </label>

              <label htmlFor="new-website-setup" className="flex w-44 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.websiteWidgets.installMethodLabel')}
                </span>
                <select
                  id="new-website-setup"
                  value={setup}
                  onChange={(event) => setSetup(event.target.value as Website['setup'])}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  <option value="manual">
                    {t('settings.websiteWidgets.installMethod.manual')}
                  </option>
                  <option value="platform">
                    {t('settings.websiteWidgets.installMethod.platform')}
                  </option>
                </select>
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? t('settings.adding') : t('settings.websiteWidgets.addButton')}
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
              title={t('settings.websiteWidgets.empty.title')}
              description={t('settings.websiteWidgets.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((site) => (
                <li key={site.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <PlatformIcon setup={site.setup} />
                    <span className="flex-1 font-mono text-sm">{site.domain}</span>

                    <span className="flex flex-col items-end">
                      <StatusDot
                        tone={STATUS_KEYS[site.status].tone}
                        label={t(STATUS_KEYS[site.status].labelKey)}
                      />
                      {site.status === 'connected' && (
                        <span className="text-2xs text-content-tertiary">
                          {t('settings.websiteWidgets.testMessageReceived')}
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      aria-expanded={openSnippet === site.id}
                      onClick={() => setOpenSnippet(openSnippet === site.id ? null : site.id)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {openSnippet === site.id
                        ? t('settings.websiteWidgets.hideCode')
                        : t('settings.websiteWidgets.getCode')}
                    </button>

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(site.id)}
                        aria-label={t('settings.websiteWidgets.removeAriaLabel', {
                          domain: site.domain,
                        })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.remove')}
                      </button>
                    )}
                  </div>

                  {openSnippet === site.id && (
                    <SnippetPanel snippet={site.snippet} domain={site.domain} />
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <p className="text-2xs text-content-tertiary">
              {t('settings.websiteWidgets.footerHintPrefix')} <code>&lt;/body&gt;</code>{' '}
              {t('settings.websiteWidgets.footerHintSuffix')}
            </p>
            <a
              href="#widget-customization"
              className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
            >
              {t('settings.websiteWidgets.customizeWidget')}
            </a>
          </div>
        </Card>
      )}
    </Section>
  );
}

/**
 * Documentation only (FR-MOD-13.5, 13.5-g) — shown alongside the install
 * snippet so a developer wiring up the checkout confirmation page sees the
 * call right next to where the widget itself is pasted in. `nexa` is the
 * general command surface the loader exposes once pasted above; calling it
 * before the widget has finished loading queues the call rather than losing
 * it.
 */
const TRACK_SALE_EXAMPLE =
  "nexa('trackSale', { external_order_id: 'order-123', amount_cents: 4999, currency: 'USD' });";

/**
 * The code to paste, plus the two ways to hand it off: copy it, or mail it to a
 * developer. The mail is composed as a `mailto:` so it is the admin's own mail
 * client that sends it, never us.
 */
function SnippetPanel({ snippet, domain }: { snippet: string; domain: string }): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard?.writeText(snippet).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  };

  const mailto = `mailto:?subject=${encodeURIComponent(
    t('settings.websiteWidgets.mailtoSubject', { domain }),
  )}&body=${encodeURIComponent(t('settings.websiteWidgets.mailtoBody', { domain, snippet }))}`;

  return (
    <div className="rounded-md border border-border bg-inset">
      <pre
        data-testid="website-snippet"
        className="overflow-x-auto px-3 py-2 font-mono text-2xs leading-relaxed text-content-secondary"
      >
        {snippet}
      </pre>
      <div className="border-t border-border px-3 py-2">
        <p className="text-2xs text-content-tertiary">
          {t('settings.websiteWidgets.snippet.reportSale')}
        </p>
        <pre
          data-testid="website-snippet-track-sale"
          className="mt-1 overflow-x-auto font-mono text-2xs leading-relaxed text-content-secondary"
        >
          {TRACK_SALE_EXAMPLE}
        </pre>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          {copied ? t('settings.copied') : t('settings.websiteWidgets.snippet.copyCode')}
        </button>
        <a
          href={mailto}
          className="rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('settings.websiteWidgets.snippet.inviteDeveloper')}
        </a>
      </div>
    </div>
  );
}

function PlatformIcon({ setup }: { setup: Website['setup'] }): ReactElement {
  const t = useTranslate();
  // The schema stores only manual vs platform (PRD §8.4), so the icon marks the
  // install method rather than the specific platform brand.
  const label =
    setup === 'platform'
      ? t('settings.websiteWidgets.platformInstall')
      : t('settings.websiteWidgets.manualInstall');
  return (
    <span
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-inset font-mono text-2xs text-content-secondary"
    >
      {setup === 'platform' ? '◧' : '</>'}
    </span>
  );
}

/**
 * Trust a domain, treating "already trusted" as success. Adding a website only
 * needs the domain to be on the allowlist, not to have put it there itself.
 */
async function trustDomain(api: ApiClient, domain: string): Promise<void> {
  try {
    await api.post('/settings/trusted-domains', { domain, include_subdomains: false });
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      (error.type === 'not_allowed' || error.status === 409 || error.status === 403)
    ) {
      return;
    }
    throw error;
  }
}
