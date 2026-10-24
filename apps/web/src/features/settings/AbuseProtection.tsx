/**
 * Settings › Security › Abuse protection (tm 339.3 · GV-01).
 *
 * The two switches that keep one visitor — or a script posing as hundreds —
 * from spending the workspace's AI or flooding it with conversations:
 *
 *   - **The allowance** (`ai_turns_per_customer_day`, tm 339.1): how many AI
 *     replies one visitor gets per day before their next message goes to a
 *     person. 40 unless saved; 0 turns it off.
 *   - **The human check** (`captcha_mode`, tm 339.2): never, only when the risk
 *     signals fire (the default), or before every new conversation. The widget
 *     draws the check itself; a visitor who passes is not asked again for 12
 *     hours and a recognised returning visitor is never asked.
 *
 * Both ride `PATCH /settings/security` and one Save, like File sharing beside
 * it — its own file because the i18n coverage sentinel claims whole files
 * (`FileSharing.tsx`'s precedent). Below the form sits today's use of the
 * allowance, read from `GET /ai/usage` (owner and admin only; an agent sees the
 * form without it).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { CAPTCHA_MODES, isCaptchaMode, type CaptchaMode } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, useForm, type Validator } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { canViewAiUsage, useAiUsage } from './ai-usage.js';
import { PerMemberQuota } from '../../components/settings/PerMemberQuota.js';

interface SecuritySettings {
  ai_turns_per_customer_day: number;
  captcha_mode: CaptchaMode;
  updated_at: string | null;
}

/** Mirrors the server's range (`PATCH /settings/security`). */
const ALLOWANCE_MAX = 10_000;

const MODE_KEYS: Record<CaptchaMode, { label: string; hint: string }> = {
  off: { label: 'settings.abuse.mode.off', hint: 'settings.abuse.mode.offHint' },
  risk: { label: 'settings.abuse.mode.risk', hint: 'settings.abuse.mode.riskHint' },
  always_on_chat_start: {
    label: 'settings.abuse.mode.always',
    hint: 'settings.abuse.mode.alwaysHint',
  },
};

export function AbuseProtection({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  if (settings.error) return <ErrorNotice message={t('settings.abuse.loadError')} />;

  return (
    <Section
      id="section-abuse-protection"
      title={t('settings.abuse.title')}
      description={t('settings.abuse.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <AbuseForm
            current={settings.data}
            canEdit={canEdit}
            onSaved={(data) => queryClient.setQueryData(['settings', 'security'], data)}
          />
        )}
      </Card>
      <QuotaToday />
    </Section>
  );
}

/** Today's use of the allowance — for the roles `GET /ai/usage` answers, and only once it has. */
function QuotaToday(): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  const usage = useAiUsage(canViewAiUsage(role));
  const quota = usage.data?.per_member;
  if (!quota) return null;
  return (
    <Card>
      <PerMemberQuota quota={quota} className="p-4" />
    </Card>
  );
}

function allowance(message: string): Validator {
  return (value) => {
    const text = value.trim();
    if (!/^\d+$/.test(text)) return message;
    return Number(text) <= ALLOWANCE_MAX ? null : message;
  };
}

/**
 * Mounted only once the settings have loaded, so `useForm`'s `initial` is the
 * saved values on the first render (`FileSharingForm`'s reasoning).
 */
function AbuseForm({
  current,
  canEdit,
  onSaved,
}: {
  current: SecuritySettings;
  canEdit: boolean;
  onSaved: (data: SecuritySettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (body: Partial<SecuritySettings>) =>
      api.patch<SecuritySettings>('/settings/security', body),
    onSuccess: onSaved,
  });

  const form = useForm({
    initial: {
      allowance: String(current.ai_turns_per_customer_day),
      mode: isCaptchaMode(current.captcha_mode) ? current.captcha_mode : 'risk',
    },
    validators: { allowance: allowance(t('settings.abuse.allowanceError')) },
    onSubmit: async (values, { setSubmitError }) => {
      const turns = Number(values.allowance.trim());
      try {
        await save.mutateAsync({
          // Only what moved: the audit entry names the fields written.
          ...(turns !== current.ai_turns_per_customer_day
            ? { ai_turns_per_customer_day: turns }
            : {}),
          ...(values.mode !== current.captcha_mode && isCaptchaMode(values.mode)
            ? { captcha_mode: values.mode }
            : {}),
        });
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const allowanceError = form.errorFor('allowance');

  return (
    <form onSubmit={form.handleSubmit} noValidate className="divide-y divide-border">
      <div className="flex flex-col gap-1 p-4">
        <label htmlFor="ai-turns-per-customer-day" className="flex w-48 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.abuse.allowanceLabel')}
          </span>
          <input
            id="ai-turns-per-customer-day"
            type="number"
            min={0}
            max={ALLOWANCE_MAX}
            step={1}
            value={form.values.allowance}
            disabled={!canEdit}
            onChange={(event) => form.setValue('allowance', event.target.value)}
            onBlur={() => form.blur('allowance')}
            aria-invalid={allowanceError ? true : undefined}
            aria-describedby={
              allowanceError
                ? 'ai-turns-per-customer-day-error ai-turns-per-customer-day-hint'
                : 'ai-turns-per-customer-day-hint'
            }
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
        </label>
        <FieldError id="ai-turns-per-customer-day-error" message={allowanceError} />
        <span id="ai-turns-per-customer-day-hint" className="text-2xs text-content-tertiary">
          {t('settings.abuse.allowanceHint')}
        </span>
      </div>

      <fieldset disabled={!canEdit} className="flex flex-col gap-2 p-4">
        <legend className="text-sm font-medium">{t('settings.abuse.modeLegend')}</legend>
        <p className="text-2xs text-content-tertiary">{t('settings.abuse.modeIntro')}</p>
        {CAPTCHA_MODES.map((mode) => (
          <label key={mode} className="flex items-start gap-3 py-1">
            <input
              type="radio"
              name="captcha-mode"
              value={mode}
              checked={form.values.mode === mode}
              onChange={() => form.setValue('mode', mode)}
              className="mt-0.5"
            />
            <span className="flex-1 text-sm">
              {t(MODE_KEYS[mode].label)}
              <span className="block text-2xs text-content-tertiary">
                {t(MODE_KEYS[mode].hint)}
              </span>
            </span>
          </label>
        ))}
        <p className="text-2xs text-content-tertiary">{t('settings.abuse.privacyNote')}</p>
      </fieldset>

      {canEdit && <FormSaveBar form={form} />}
    </form>
  );
}
