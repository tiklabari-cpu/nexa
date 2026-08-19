/**
 * Settings → Trusted domains (FR-MOD-08.9.1).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * The allowlist the widget checks. Leads because it is the one setting that
 * gates the product working at all: until a customer's domain is here, the
 * widget on their site cannot mint a token, and the failure looks like a
 * broken widget rather than missing configuration.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

interface TrustedDomain {
  id: string;
  domain: string;
  include_subdomains: boolean;
  created_at: string;
}

export function TrustedDomains({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState('');
  const [includeSubdomains, setIncludeSubdomains] = useState(false);

  const list = useQuery({
    queryKey: ['settings', 'trusted-domains'],
    queryFn: () => api.get<{ items: TrustedDomain[] }>('/settings/trusted-domains'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'trusted-domains'] });

  const add = useMutation({
    mutationFn: (body: { domain: string; include_subdomains: boolean }) =>
      api.post<TrustedDomain>('/settings/trusted-domains', body),
    onSuccess: () => {
      setDomain('');
      setIncludeSubdomains(false);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/trusted-domains/${id}`),
    onSuccess: invalidate,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!domain.trim()) return;
    add.mutate({ domain: domain.trim(), include_subdomains: includeSubdomains });
  }

  return (
    <Section
      title={t('settings.trustedDomains.title')}
      description={t('settings.trustedDomains.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.trustedDomains.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={submit}
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-domain" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.trustedDomains.domainLabel')}
                </span>
                <input
                  id="new-domain"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="shop.example"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <label className="flex items-center gap-2 pb-1.5 text-sm text-content-secondary">
                <input
                  type="checkbox"
                  checked={includeSubdomains}
                  onChange={(event) => setIncludeSubdomains(event.target.checked)}
                />
                {t('settings.trustedDomains.includeSubdomains')}
              </label>

              <button
                type="submit"
                disabled={!domain.trim() || add.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {add.isPending ? t('settings.adding') : t('settings.trustedDomains.addButton')}
              </button>

              {add.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {t(errorMessageKey(add.error))}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.trustedDomains.empty.title')}
              description={t('settings.trustedDomains.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">
                    {item.include_subdomains && <span className="text-content-tertiary">*.</span>}
                    {item.domain}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('settings.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}
