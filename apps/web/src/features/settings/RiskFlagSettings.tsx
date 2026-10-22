/**
 * Settings → Risk flags (AI-27 · tm 302.3).
 *
 * Two settings and a legend. The settings are the ones `GET|PUT
 * /risk-flags/settings` holds: which team is the Responsible Gaming team (it
 * reads the note a flag carries, and hears of an urgent flag at once) and up
 * to five addresses an urgent flag is mailed to besides the workspace's
 * supervisors. The legend is the catalogue the platform ships — what each
 * flag type is, how serious, whose, who clears it and what it does — read off
 * `RISK_FLAG_DEFAULTS`, the same table the server enforces, so the screen
 * cannot say something the policy does not do. The types and their effects are
 * not editable: they are the platform's, not a workspace's.
 *
 * Admin and up read and write (`minimumRole: 'admin'` on both routes), so
 * anyone below is not shown a door that only answers 403; the route stays the
 * real boundary. A saved address list is sent only when it changed, so a team
 * change alone is not recorded as a change of who is mailed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import {
  RISK_FLAG_DEFAULTS,
  RISK_FLAG_NOTIFY_EMAILS_MAX,
  RISK_FLAG_TYPES,
  type RiskFlagType,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, useForm, type Validator } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  RISK_FLAG_SETTINGS_KEY,
  clearerRole,
  firstBadEmail,
  parseEmailList,
  policyKeys,
  type RiskFlagSettingsData,
} from '../risk/riskFlags.js';

/** Mirrors the server's `minimumRole: 'admin'` on both settings routes. */
const ROLES = new Set(['admin', 'viceowner', 'owner']);

interface Team {
  id: number;
  name: string;
}

type FormValues = Record<'team' | 'emails', string>;

export function RiskFlagSettings({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !ROLES.has(role)) return null;
  return <RiskFlagSettingsCard canEdit={canEdit} />;
}

function RiskFlagSettingsCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: RISK_FLAG_SETTINGS_KEY,
    queryFn: () => api.get<RiskFlagSettingsData>('/risk-flags/settings'),
  });
  // Same key the Teams page and the Details panel read: no second request.
  const teams = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
    staleTime: 60_000,
  });

  if (settings.error) return <ErrorNotice message={t('settings.riskFlags.loadError')} />;

  return (
    <Section
      id="section-risk-flags"
      title={t('settings.riskFlags.title')}
      description={t('settings.riskFlags.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <RiskFlagSettingsForm
            config={settings.data}
            teams={teams.data?.items ?? []}
            canEdit={canEdit}
            onSaved={(data) => queryClient.setQueryData(RISK_FLAG_SETTINGS_KEY, data)}
          />
        )}
      </Card>
      <Card>
        <RiskFlagLegend />
      </Card>
    </Section>
  );
}

/**
 * Mounted once the saved settings are in, so the form starts from them rather
 * than from empty fields racing the request.
 */
function RiskFlagSettingsForm({
  config,
  teams,
  canEdit,
  onSaved,
}: {
  config: RiskFlagSettingsData;
  teams: readonly Team[];
  canEdit: boolean;
  onSaved: (data: RiskFlagSettingsData) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const savedTeam = config.rg_group_id === null ? '' : String(config.rg_group_id);
  const savedEmails = config.notify_emails.join(', ');

  const save = useMutation({
    mutationFn: (body: { rg_group_id?: number | null; notify_emails?: string[] }) =>
      api.put<RiskFlagSettingsData>('/risk-flags/settings', body),
    onSuccess: onSaved,
  });

  // Empty is a valid list: nobody is mailed beyond the supervisors. (The
  // shared `emailList` validator refuses empty — it is for a form that must
  // send somewhere.)
  const emailsValidator: Validator = (raw) => {
    const addresses = parseEmailList(raw);
    if (addresses.length > RISK_FLAG_NOTIFY_EMAILS_MAX) {
      return t('settings.riskFlags.emailsTooMany', { max: RISK_FLAG_NOTIFY_EMAILS_MAX });
    }
    const bad = firstBadEmail(addresses);
    return bad === null ? null : t('settings.riskFlags.emailsInvalid', { address: bad });
  };

  const form = useForm<FormValues>({
    initial: { team: savedTeam, emails: savedEmails },
    validators: { emails: emailsValidator },
    onSubmit: async (values, { setSubmitError }) => {
      const body: { rg_group_id?: number | null; notify_emails?: string[] } = {};
      if (values.team !== savedTeam) {
        body.rg_group_id = values.team === '' ? null : Number(values.team);
      }
      const addresses = parseEmailList(values.emails);
      if (addresses.join(',') !== config.notify_emails.join(',')) body.notify_emails = addresses;
      try {
        await save.mutateAsync(body);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  // A saved team the list no longer holds (deleted, or the list not read) is
  // still the saved value: keep it selectable so the form does not silently
  // drop it on the next save.
  const known = teams.some((team) => String(team.id) === form.values.team);
  const emailsError = form.errorFor('emails');

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <div className="flex max-w-md flex-col gap-1">
          <label
            htmlFor="risk-flags-team"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.riskFlags.teamLabel')}
          </label>
          <select
            id="risk-flags-team"
            value={form.values.team}
            onChange={(event) => form.setValue('team', event.target.value)}
            aria-describedby="risk-flags-team-hint"
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
          >
            <option value="">{t('settings.riskFlags.teamNone')}</option>
            {form.values.team !== '' && !known && (
              <option value={form.values.team}>
                {t('settings.riskFlags.teamUnknown', { id: form.values.team })}
              </option>
            )}
            {teams.map((team) => (
              <option key={team.id} value={String(team.id)}>
                {team.name}
              </option>
            ))}
          </select>
          <p id="risk-flags-team-hint" className="text-2xs text-content-tertiary">
            {t('settings.riskFlags.teamHint')}
          </p>
        </div>

        <div className="flex max-w-md flex-col gap-1">
          <label
            htmlFor="risk-flags-emails"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.riskFlags.emailsLabel')}
          </label>
          <textarea
            id="risk-flags-emails"
            rows={2}
            value={form.values.emails}
            onChange={(event) => form.setValue('emails', event.target.value)}
            onBlur={() => form.blur('emails')}
            aria-invalid={emailsError ? true : undefined}
            aria-describedby={
              emailsError
                ? 'risk-flags-emails-error risk-flags-emails-hint'
                : 'risk-flags-emails-hint'
            }
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
          />
          <FieldError id="risk-flags-emails-error" message={emailsError} />
          <p id="risk-flags-emails-hint" className="text-2xs text-content-tertiary">
            {t('settings.riskFlags.emailsHint', { max: RISK_FLAG_NOTIFY_EMAILS_MAX })}
          </p>
        </div>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          {save.isSuccess && !form.isDirty && (
            <p role="status" className="text-2xs text-success">
              {t('settings.riskFlags.saved')}
            </p>
          )}
        </div>
      )}
      {canEdit && <FormSaveBar form={form} />}
    </form>
  );
}

/**
 * The catalogue as the platform ships it: per type, how serious, whose, who
 * clears it and what it does to the AI and the campaigns. Read off the
 * shared defaults the server applies.
 */
function RiskFlagLegend(): ReactElement {
  const t = useTranslate();
  return (
    <div className="p-4">
      <h3 className="text-sm font-medium">{t('settings.riskFlags.legend.title')}</h3>
      <p className="mb-3 text-2xs text-content-tertiary">
        {t('settings.riskFlags.legend.description')}
      </p>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{t('settings.riskFlags.legend.title')}</caption>
        <thead>
          <tr className="text-2xs uppercase tracking-wide text-content-tertiary">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t('settings.riskFlags.legend.type')}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t('settings.riskFlags.legend.severity')}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t('settings.riskFlags.legend.clearedBy')}
            </th>
            <th scope="col" className="py-1 font-medium">
              {t('settings.riskFlags.legend.effect')}
            </th>
          </tr>
        </thead>
        <tbody>
          {RISK_FLAG_TYPES.map((type) => (
            <LegendRow key={type} type={type} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegendRow({ type }: { type: RiskFlagType }): ReactElement {
  const t = useTranslate();
  const defaults = RISK_FLAG_DEFAULTS[type];
  const effects = policyKeys(type).map((key) => t(key));
  if (defaults.scope === 'member') effects.push(t('inbox.risk.staysOnPlayer'));
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="py-1.5 pr-3 font-medium">
        {t(`inbox.risk.type.${type}`)}
      </th>
      <td className="py-1.5 pr-3">{t(`inbox.risk.severity.${defaults.severity}`)}</td>
      <td className="py-1.5 pr-3">
        {t('settings.riskFlags.legend.andUp', { role: t(`team.role.${clearerRole(type)}`) })}
      </td>
      <td className="py-1.5 text-content-secondary">
        {effects.length > 0 ? effects.join(' · ') : t('inbox.risk.add.noPolicy')}
      </td>
    </tr>
  );
}
