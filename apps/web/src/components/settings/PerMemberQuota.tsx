/**
 * Today's use of the per-member AI allowance (tm 339.3 · GV-01): how many
 * visitors the AI answered, and how many of them have used the whole allowance
 * and are with a person now. Counts only — the endpoint (`GET /ai/usage`,
 * `per_member`) names no visitor and no conversation.
 *
 * Shared by Settings › Abuse protection, Settings › AI usage and the AI
 * performance tab so the three agree on what "today" means: the workspace's
 * conversation day (its day boundary), not the UTC day the token meters use.
 */
import { type ReactElement } from 'react';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { AiUsagePerMember } from '../../features/settings/ai-usage.js';

const count = (n: number): string => formatCount(n) ?? String(n);

export function PerMemberQuota({
  quota,
  className = '',
}: {
  quota: AiUsagePerMember;
  className?: string;
}): ReactElement {
  const t = useTranslate();
  const heading = t('settings.perMemberQuota.title');
  return (
    <section aria-label={heading} className={`flex flex-col gap-2 ${className}`}>
      <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {heading}
      </p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label={t('settings.perMemberQuota.limit')}
          value={
            quota.cap === null
              ? t('settings.perMemberQuota.noLimit')
              : t('settings.perMemberQuota.perDay', { cap: count(quota.cap) })
          }
        />
        <Stat label={t('settings.perMemberQuota.withAi')} value={count(quota.members_with_ai)} />
        <Stat label={t('settings.perMemberQuota.atCap')} value={count(quota.members_at_cap)} />
      </dl>
      <p className="text-2xs text-content-tertiary">{t('settings.perMemberQuota.hint')}</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-inset px-3 py-2">
      <dt className="text-2xs text-content-secondary">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-content">{value}</dd>
    </div>
  );
}
