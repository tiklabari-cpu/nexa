/**
 * "AI yapılandırması v13 yayında" — the Inbox band (tm 316.4 · AI-20 · ADR-14b
 * §2.10 (3)). Fed by `ai_config_published` through `lib/ai-config-notice.ts`.
 *
 * It says what changes and what does not: connections opened from now on are
 * answered by the new version, an open one keeps the version it was opened
 * with (§2.7). Someone who can read the AI configuration gets the way to the
 * versions; a dismiss only hides the band.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '../../components/ui/index.js';
import { dismissAiConfigNotice, useAiConfigNotice } from '../../lib/ai-config-notice.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

export function AiConfigPublishedBand(): ReactElement | null {
  const t = useTranslate();
  const published = useAiConfigNotice();
  const canRead = useAuth((s) => {
    const scopes = s.agent?.scopes ?? [];
    return scopes.includes('agents-bot--all:rw') || scopes.includes('agents-bot--all:ro');
  });
  if (!published) return null;

  return (
    <div className="border-b border-border px-4 py-2" data-testid="ai-config-published-band">
      <Banner
        tone="info"
        role="status"
        title={
          published.rollback_of
            ? t('inbox.aiConfig.rolledBack', { label: published.label })
            : t('inbox.aiConfig.published', { label: published.label })
        }
        dismissible
        dismissLabel={t('inbox.aiConfig.dismiss')}
        onDismiss={dismissAiConfigNotice}
        cta={
          canRead && (
            <Link
              to={`/app/playbook?view=versions&version=${encodeURIComponent(published.version_id)}`}
              onClick={dismissAiConfigNotice}
              className="inline-flex min-h-6 items-center rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-content hover:bg-surface-2"
            >
              {t('inbox.aiConfig.open')}
            </Link>
          )
        }
      >
        <p>{t('inbox.aiConfig.text')}</p>
      </Banner>
    </div>
  );
}
