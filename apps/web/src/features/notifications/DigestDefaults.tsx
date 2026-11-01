/**
 * The workspace default for the summary e-mails (RP-05 · tm 372): which roles
 * receive the daily and the weekly summary until a member chooses for
 * themselves. Shown to the Founder and the Administrators, under the personal
 * switches in Settings → Notifications.
 *
 * A grid of role × frequency. It is a shared setting rather than a personal
 * preference, so it writes on Save (the sticky bar, Discard, leave guard) and
 * not the moment a box is ticked like the switches above it. What is saved is a
 * role list, not a roster: a member who has chosen for themselves keeps their
 * choice, and anyone else follows this — including people who join later.
 *
 * A role that cannot read reports (an Agent, unless the permission matrix says
 * otherwise) receives nothing whatever is ticked here; the hint says so, because
 * a ticked box that sends nothing would read as a bug.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import { AGENT_ROLES, type AgentRole, type DigestSettings } from '@siyahtus/types';
import { Card, ErrorNotice } from '../../components/Page.js';
import { SaveBar } from '../../components/settings/SaveBar.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

const QUERY_KEY = ['settings', 'digests'] as const;

const sameRoles = (a: readonly AgentRole[], b: readonly AgentRole[]): boolean =>
  a.length === b.length && a.every((role) => b.includes(role));

export function DigestDefaults(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<DigestSettings>('/settings/digests'),
  });

  if (settings.error) return <ErrorNotice message={t('team.notifications.digest.loadError')} />;
  if (settings.isPending) {
    return (
      <Card>
        <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
      </Card>
    );
  }
  return (
    <DigestDefaultsForm
      saved={settings.data}
      onSaved={(data) => queryClient.setQueryData(QUERY_KEY, data)}
    />
  );
}

/** Mounted once the saved values have loaded, so the draft starts from them. */
function DigestDefaultsForm({
  saved,
  onSaved,
}: {
  saved: DigestSettings;
  onSaved: (data: DigestSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [daily, setDaily] = useState<AgentRole[]>(saved.daily_roles);
  const [weekly, setWeekly] = useState<AgentRole[]>(saved.weekly_roles);

  const dirty = useMemo(
    () => !sameRoles(daily, saved.daily_roles) || !sameRoles(weekly, saved.weekly_roles),
    [daily, weekly, saved],
  );

  const save = useMutation({
    mutationFn: () =>
      api.put<DigestSettings>('/settings/digests', { daily_roles: daily, weekly_roles: weekly }),
    onSuccess: (data) => {
      onSaved(data);
      setDaily(data.daily_roles);
      setWeekly(data.weekly_roles);
    },
  });
  useSettingsLeaveGuard(dirty, save.isPending);

  const toggle = (
    list: AgentRole[],
    set: (next: AgentRole[]) => void,
    role: AgentRole,
    on: boolean,
  ): void => set(on ? [...list, role] : list.filter((r) => r !== role));

  return (
    <Card>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-content">
            {t('team.notifications.digest.defaults.title')}
          </legend>
          <p className="text-2xs text-content-secondary">
            {t('team.notifications.digest.defaults.hint')}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs text-content-secondary">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t('team.notifications.digest.defaults.role')}
                </th>
                <th scope="col" className="px-3 py-1 font-medium">
                  {t('team.notifications.digest.daily.label')}
                </th>
                <th scope="col" className="px-3 py-1 font-medium">
                  {t('team.notifications.digest.weekly.label')}
                </th>
              </tr>
            </thead>
            <tbody>
              {AGENT_ROLES.map((role) => (
                <tr key={role} className="border-t border-border">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal text-content">
                    {t(`team.role.${role}`)}
                  </th>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={daily.includes(role)}
                      aria-label={`${t(`team.role.${role}`)} · ${t('team.notifications.digest.daily.label')}`}
                      onChange={(event) => toggle(daily, setDaily, role, event.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={weekly.includes(role)}
                      aria-label={`${t(`team.role.${role}`)} · ${t('team.notifications.digest.weekly.label')}`}
                      onChange={(event) => toggle(weekly, setWeekly, role, event.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-2xs text-content-secondary">
            {t('team.notifications.digest.defaults.reachNote')}
          </p>
        </fieldset>
        <SaveBar
          submit
          dirty={dirty}
          saving={save.isPending}
          error={save.error ?? undefined}
          onDiscard={() => {
            setDaily(saved.daily_roles);
            setWeekly(saved.weekly_roles);
            save.reset();
          }}
        />
      </form>
    </Card>
  );
}
