/**
 * The Security page's counters (tm 389.16 · FR-ADMIN-22): failed sign-ins, sign-ups by address
 * and the abuse counters of the tenant API's guards.
 *
 * Numbers, addresses and licence numbers only — a workspace's name, a message or a customer's
 * details are never on this page. A source that is not there says so (`not_available`,
 * `not_installed`) instead of showing a zero that would read as "all quiet".
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '../../components/ui/index.js';
import { formatCount, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { Cell, DataTable, LINK_CLASS } from '../workspaces/ui.js';
import { StateBadge } from '../dashboard/HealthSection.js';
import {
  FAILED_LOGIN_SPANS,
  SIGNUP_SPANS,
  useAbuseCounters,
  useFailedLogins,
  useSignupsByIp,
} from './queries.js';
import { CountTable, Figures, Section, SpanPicker } from './ui.js';

function WorkspaceLink({ licenseId }: { licenseId: string }): ReactElement {
  return (
    <Link to={`/workspaces/${licenseId}`} className={LINK_CLASS}>
      {licenseId}
    </Link>
  );
}

export function FailedLoginsSection(): ReactElement {
  const t = useTranslate();
  const [hours, setHours] = useState<number>(24);
  const query = useFailedLogins(hours);
  const data = query.data;

  return (
    <Section
      id="security-failed-logins"
      title={t('security.failed.heading')}
      query={query}
      hasData={data !== undefined}
      actions={
        <SpanPicker
          label={t('security.failed.span')}
          spans={FAILED_LOGIN_SPANS}
          value={hours}
          onChange={setHours}
          format={(span) => t('security.span.hours', { count: span })}
        />
      }
    >
      {data && (
        <div className="flex flex-col gap-2 pb-2">
          <h3 className="px-4 pt-4 text-sm font-medium">{t('security.failed.live.heading')}</h3>
          {data.tenant.live.status === 'unavailable' ? (
            <div className="px-4">
              <Banner tone="warning">{t('security.failed.live.unavailable')}</Banner>
            </div>
          ) : (
            <>
              <Figures
                items={[
                  {
                    label: t('security.failed.live.addresses', {
                      seconds: data.tenant.live.window_seconds,
                    }),
                    value: formatCount(data.tenant.live.addresses_total),
                  },
                  {
                    label: t('security.failed.live.locked', { limit: data.tenant.live.limit }),
                    value: formatCount(data.tenant.live.locked_total),
                  },
                ]}
              />
              {data.tenant.live.addresses.length === 0 ? (
                <p className="px-4 text-sm text-content-secondary">
                  {t('security.failed.live.none')}
                </p>
              ) : (
                <DataTable
                  caption={t('security.failed.live.caption')}
                  headers={[
                    t('security.col.address'),
                    t('security.failed.live.col.failures'),
                    t('security.failed.live.col.state'),
                  ]}
                >
                  {data.tenant.live.addresses.map((row) => (
                    <tr key={row.ip}>
                      <Cell>
                        <code className="text-xs">{row.ip}</code>
                      </Cell>
                      <Cell>{formatCount(row.failures)}</Cell>
                      <Cell>
                        <StateBadge
                          state={row.locked ? 'down' : 'ok'}
                          label={t(
                            row.locked
                              ? 'security.failed.live.locked.badge'
                              : 'security.failed.live.counting',
                          )}
                        />
                      </Cell>
                    </tr>
                  ))}
                </DataTable>
              )}
              {data.tenant.live.truncated && (
                <p className="px-4 text-xs text-content-secondary">
                  {t('security.failed.live.truncated')}
                </p>
              )}
            </>
          )}

          <h3 className="px-4 pt-4 text-sm font-medium">
            {t('security.failed.history.heading', { count: data.hours })}
          </h3>
          <Figures
            items={[
              {
                label: t('security.failed.history.total'),
                value: formatCount(data.tenant.history.total),
              },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <CountTable
              caption={t('security.failed.history.byIp')}
              keyHeader={t('security.col.address')}
              rows={data.tenant.history.by_ip}
              empty={t('security.failed.history.none')}
            />
            <CountTable
              caption={t('security.failed.history.byWorkspace')}
              keyHeader={t('security.col.workspace')}
              rows={data.tenant.history.by_workspace}
              empty={t('security.failed.history.none')}
              keyLabel={(key) => <WorkspaceLink licenseId={key} />}
            />
          </div>

          <h3 className="px-4 pt-4 text-sm font-medium">
            {t('security.failed.operator.heading', { count: data.hours })}
          </h3>
          <Figures
            items={[
              {
                label: t('security.failed.operator.signIn'),
                value: formatCount(data.operator.sign_in_failed),
              },
              {
                label: t('security.failed.operator.totp'),
                value: formatCount(data.operator.totp_failed),
              },
            ]}
          />
          <CountTable
            caption={t('security.failed.operator.byIp')}
            keyHeader={t('security.col.address')}
            rows={data.operator.by_ip}
            empty={t('security.failed.history.none')}
          />
          <p className="px-4 pt-2 text-xs text-content-secondary">
            {t('security.failed.note', {
              time: formatDateTime(data.generated_at) ?? data.generated_at,
            })}
          </p>
        </div>
      )}
    </Section>
  );
}

export function SignupsByIpSection(): ReactElement {
  const t = useTranslate();
  const [days, setDays] = useState<number>(7);
  const query = useSignupsByIp(days);
  const data = query.data;

  return (
    <Section
      id="security-signups"
      title={t('security.signups.heading')}
      query={query}
      hasData={data !== undefined}
      actions={
        <SpanPicker
          label={t('security.signups.span')}
          spans={SIGNUP_SPANS}
          value={days}
          onChange={setDays}
          format={(span) => t('security.span.days', { count: span })}
        />
      }
    >
      {data && data.status === 'not_available' ? (
        <div className="p-4">
          <Banner tone="info" title={t('security.signups.notAvailable.title')}>
            {t('security.signups.notAvailable.body')}
          </Banner>
        </div>
      ) : (
        data && (
          <CountTable
            caption={t('security.signups.caption', { count: data.days })}
            keyHeader={t('security.col.address')}
            rows={data.data}
            empty={t('security.signups.none')}
          />
        )
      )}
    </Section>
  );
}

export function AbuseCountersSection(): ReactElement {
  const t = useTranslate();
  const query = useAbuseCounters();
  const data = query.data;

  return (
    <Section
      id="security-abuse"
      title={t('security.abuse.heading')}
      query={query}
      hasData={data !== undefined}
    >
      {data && (
        <div className="flex flex-col gap-2 pb-2">
          <h3 className="px-4 pt-4 text-sm font-medium">{t('security.abuse.invites.heading')}</h3>
          {data.invites.status === 'available' ? (
            <>
              <Figures
                items={[
                  {
                    label: t('security.abuse.invites.atLimit', {
                      limit: data.invites.limit_per_day,
                    }),
                    value: formatCount(data.invites.workspaces_at_limit),
                  },
                ]}
              />
              <CountTable
                caption={t('security.abuse.invites.caption')}
                keyHeader={t('security.col.workspace')}
                rows={data.invites.workspaces}
                empty={t('security.abuse.none')}
                keyLabel={(key) => <WorkspaceLink licenseId={key} />}
              />
            </>
          ) : (
            <Unavailable status={data.invites.status} />
          )}

          <h3 className="px-4 pt-4 text-sm font-medium">{t('security.abuse.quota.heading')}</h3>
          {data.widget_quota.status === 'available' ? (
            <>
              <Figures
                items={[
                  {
                    label: t('security.abuse.quota.members', { day: data.widget_quota.day }),
                    value: formatCount(data.widget_quota.members_at_cap),
                  },
                  {
                    label: t('security.abuse.quota.workspaces'),
                    value: formatCount(data.widget_quota.workspaces_affected),
                  },
                ]}
              />
              <CountTable
                caption={t('security.abuse.quota.caption')}
                keyHeader={t('security.col.workspace')}
                rows={data.widget_quota.workspaces}
                empty={t('security.abuse.none')}
                keyLabel={(key) => <WorkspaceLink licenseId={key} />}
              />
            </>
          ) : (
            <Unavailable status={data.widget_quota.status} />
          )}

          <h3 className="px-4 pt-4 text-sm font-medium">{t('security.abuse.challenge.heading')}</h3>
          <p className="px-4 text-sm text-content-secondary">
            {t('security.abuse.challenge.body')}
          </p>
          <p className="px-4 pb-2 text-sm">
            {data.widget_challenge.component
              ? t('security.abuse.challenge.component', {
                  state: data.widget_challenge.component.state,
                  detail: data.widget_challenge.component.detail ?? '—',
                })
              : t('security.abuse.challenge.unknown')}
          </p>
        </div>
      )}
    </Section>
  );
}

function Unavailable({
  status,
}: {
  status: 'not_installed' | 'not_available' | 'available';
}): ReactElement {
  const t = useTranslate();
  return (
    <p className="px-4 pb-2 text-sm text-content-secondary">
      {status === 'not_installed'
        ? t('security.abuse.notInstalled')
        : t('security.abuse.notAvailable')}
    </p>
  );
}
