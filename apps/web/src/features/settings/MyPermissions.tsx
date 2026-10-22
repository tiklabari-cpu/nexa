/**
 * Settings › Security › My permissions — "Yetkilerim" (RL-02 · tm 325.4).
 *
 * What the signed-in person may do in this workspace, read-only: their role
 * and every capability's value for it, grouped as the matrix groups them. Any
 * member can open it — it reads only `GET /auth/me` `capabilities`, the
 * session's own snapshot (tm 325.3), so it shows what the servers enforce for
 * this session rather than what the role would hold by default.
 *
 * Fetched here rather than read off the profile in the auth store: the store
 * holds the profile from sign-in, and the point of the page is the answer
 * after the Kurucu's latest change (sessions follow it within a minute).
 */
import { CAPABILITIES, CAPABILITY_GROUPS } from '@siyahtus/types';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { capabilityLabel, roleLabel, valueLabel } from './PermissionsMatrix.js';

interface MyProfile {
  role: string;
  /** Absent from a server older than tm 325.2. */
  capabilities?: Record<string, string>;
}

export function MyPermissions(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const me = useQuery({
    queryKey: ['auth', 'me', 'permissions'],
    queryFn: () => api.get<MyProfile>('/auth/me'),
    refetchOnMount: 'always',
  });

  const capabilities = me.data?.capabilities ?? {};

  return (
    <Section
      id="section-my-permissions"
      title={t('settings.myPermissions.title')}
      description={t('settings.myPermissions.description')}
    >
      {me.error ? (
        <ErrorNotice message={t('settings.myPermissions.loadError')} />
      ) : (
        <Card>
          {me.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <p className="text-sm">
                {t('settings.myPermissions.role', { role: roleLabel(t, me.data.role) })}
              </p>
              {CAPABILITY_GROUPS.map((group) => {
                const rows = CAPABILITIES.filter(
                  (capability) => capability.group === group && capabilities[capability.key],
                );
                if (rows.length === 0) return null;
                return (
                  <section key={group} aria-labelledby={`my-permissions-${group}`}>
                    <h3
                      id={`my-permissions-${group}`}
                      className="mb-1 text-xs font-semibold text-content-secondary"
                    >
                      {t(`permissions.group.${group}`)}
                    </h3>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-sm">
                      {rows.map((capability) => (
                        <div key={capability.key} className="contents">
                          <dt>{capabilityLabel(t, capability.key)}</dt>
                          <dd
                            data-capability={capability.key}
                            className="text-right text-content-secondary"
                          >
                            {valueLabel(t, capabilities[capability.key]!)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}
              <p className="text-2xs text-content-tertiary">{t('settings.myPermissions.note')}</p>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}
