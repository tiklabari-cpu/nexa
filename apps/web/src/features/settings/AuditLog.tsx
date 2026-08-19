/**
 * The door into the security trail (NFR-S12) — Integrations' pattern: a full
 * page's worth of list lives behind its own route, not a form field here.
 * Hidden entirely without `audit_log--all:ro`, so a teammate who cannot read
 * the trail is not shown a door that only leads to a 403. That hiding is a
 * courtesy, not the boundary — the route itself carries the real gate (scope +
 * `minimumRole: admin`, see `apps/api/src/routes/audit-log.ts`).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated.
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Card, Section } from '../../components/Page.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

export function AuditLog(): ReactElement | null {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  if (!scopes.includes('audit_log--all:ro')) return null;

  return (
    <Section title={t('settings.auditLog.title')} description={t('settings.auditLog.description')}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-content-secondary">{t('settings.auditLog.body')}</p>
          <Link
            to="/app/settings/audit-log"
            className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t('settings.auditLog.openButton')}
          </Link>
        </div>
      </Card>
    </Section>
  );
}
