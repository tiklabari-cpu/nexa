/**
 * The platform's locked guardrails G1–G19 (tm 301.4 · AI-08), read-only.
 *
 * Nothing here can be switched off or edited: the API answers any write against
 * them with 403 `guardrail_platform_locked`, so the screen offers no control —
 * it shows what every turn runs under, in the console's language, and the
 * catalogue version each turn records. A workspace only adds stricter things
 * (the sections below).
 */
import { useQuery } from '@tanstack/react-query';
import { GUARDRAIL_CATEGORIES } from '@siyahtus/types';
import type { ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useLocale, useTranslate } from '../../lib/i18n.js';
import type { PlatformGuardrail, PlatformGuardrails } from './types.js';

export const platformGuardrailsKey = ['playbook', 'guardrails', 'platform'] as const;

/** The catalogue read, shared by the list and the hit log's rule names. */
export function usePlatformGuardrails() {
  const api = useApiClient();
  return useQuery({
    queryKey: platformGuardrailsKey,
    queryFn: () => api.get<PlatformGuardrails>('/ai-guardrails/platform'),
    // Code, not data: it changes with a deploy, never while a screen is open.
    staleTime: 5 * 60_000,
  });
}

export const CATEGORY_LABEL_KEYS = {
  responsible_gaming: 'playbook.guardrails.category.responsible_gaming',
  money: 'playbook.guardrails.category.money',
  data_security: 'playbook.guardrails.category.data_security',
  legal: 'playbook.guardrails.category.legal',
  transparency: 'playbook.guardrails.category.transparency',
} as const;

const ACTION_LABEL_KEYS: Record<PlatformGuardrail['action'], string> = {
  force_handoff: 'playbook.guardrails.platform.action.force_handoff',
  block_output: 'playbook.guardrails.platform.action.block_output',
  block_promo: 'playbook.guardrails.platform.action.block_promo',
  warn: 'playbook.guardrails.platform.action.warn',
};

const TARGET_LABEL_KEYS = {
  responsible_gaming: 'playbook.guardrails.platform.target.responsible_gaming',
  kyc_risk: 'playbook.guardrails.platform.target.kyc_risk',
  complaints: 'playbook.guardrails.platform.target.complaints',
} as const;

const PRIORITY_LABEL_KEYS: Record<PlatformGuardrail['priority'], string> = {
  urgent: 'playbook.guardrails.platform.priority.urgent',
  high: 'playbook.guardrails.platform.priority.high',
  normal: 'playbook.guardrails.platform.priority.normal',
};

const TENANT_TEXT_LABEL_KEYS = {
  crisis: 'playbook.guardrails.platform.text.crisis',
  complaint: 'playbook.guardrails.platform.text.complaint',
  access_info: 'playbook.guardrails.platform.text.access_info',
} as const;

export function PlatformGuardrailList(): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const catalogue = usePlatformGuardrails();
  const rules = catalogue.data?.rules ?? [];

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">{t('playbook.guardrails.platform.title')}</h2>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            {t('playbook.guardrails.platform.description')}
          </p>
          {catalogue.data && (
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.guardrails.platform.version', { version: catalogue.data.version })}
            </p>
          )}
        </div>

        {catalogue.isPending ? (
          <CardSkeleton rows={3} />
        ) : catalogue.isError ? (
          <LoadError
            compact
            title={t('playbook.guardrails.platform.loadFailed')}
            error={catalogue.error}
            onRetry={() => void catalogue.refetch()}
          />
        ) : (
          GUARDRAIL_CATEGORIES.map((category) => {
            const inCategory = rules.filter((rule) => rule.category === category);
            if (inCategory.length === 0) return null;
            return (
              <section key={category} aria-labelledby={`guardrail-platform-${category}`}>
                <h3
                  id={`guardrail-platform-${category}`}
                  className="mb-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                >
                  {t(CATEGORY_LABEL_KEYS[category])}
                </h3>
                <ul role="list" className="divide-y divide-border rounded-md border border-border">
                  {inCategory.map((rule) => (
                    <li key={rule.id} className="flex flex-col gap-1 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-2xs font-semibold">
                          {rule.id}
                        </span>
                        <p className="text-sm font-medium">{rule.title[locale]}</p>
                        <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-content-secondary">
                          {t('playbook.guardrails.platform.locked')}
                        </span>
                      </div>
                      <p className="text-sm text-content-secondary">{rule.prompt[locale]}</p>
                      <p className="text-2xs text-content-tertiary">
                        {t(ACTION_LABEL_KEYS[rule.action])}
                        {rule.target ? ` · ${t(TARGET_LABEL_KEYS[rule.target])}` : ''}
                        {' · '}
                        {t(PRIORITY_LABEL_KEYS[rule.priority])}
                        {rule.tenant_text
                          ? ` · ${t(TENANT_TEXT_LABEL_KEYS[rule.tenant_text])}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </Card>
  );
}
