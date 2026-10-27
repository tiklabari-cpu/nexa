/**
 * The root panel's announcement and the read-only maintenance band, above
 * every page of the console (tm 389.13 · FR-ADMIN-15).
 *
 * The operator writes the announcement in both languages; the bar shows the
 * one the panel is in. Its level picks the colour and the glyph (the colour
 * never carries the meaning alone), and `critical` is announced as an alert.
 * Not dismissible: an operator who wants it gone sets `until` or removes it.
 *
 * `full` maintenance is not a band — the shell stands down for
 * {@link MaintenancePage} instead (`AppShell.tsx`).
 */
import type { ReactElement } from 'react';
import type { AnnouncementLevel } from '@siyahtus/types';
import { useLocale, useTranslate } from '../lib/i18n.js';
import { useNotice } from '../lib/notice.js';
import { BASE_TITLE } from '../lib/document-title.js';
import { cn } from './ui/cn.js';

const LEVEL_STYLE: Record<AnnouncementLevel, { className: string; glyph: string }> = {
  info: { className: 'border-info/30 bg-info/10', glyph: 'ℹ' },
  warning: { className: 'border-warning/30 bg-warning/10', glyph: '⚠' },
  critical: { className: 'border-danger/30 bg-danger/10', glyph: '⚠' },
};

const STRIP =
  'flex items-center justify-center gap-2 border-b px-4 py-1.5 text-center text-xs text-content';

export function NoticeBar(): ReactElement | null {
  const t = useTranslate();
  const { locale } = useLocale();
  const { announcement, maintenance } = useNotice();

  const readOnly = maintenance?.mode === 'read_only';
  if (!announcement && !readOnly) return null;

  return (
    <>
      {readOnly && (
        <div
          role="status"
          data-testid="maintenance-band"
          className={cn(STRIP, LEVEL_STYLE.warning.className)}
        >
          <span aria-hidden="true">{LEVEL_STYLE.warning.glyph}</span>
          <span>{maintenance.message?.[locale] ?? t('shell.maintenance.readOnly')}</span>
        </div>
      )}
      {announcement && (
        <div
          role={announcement.level === 'critical' ? 'alert' : 'status'}
          data-testid="notice-bar"
          data-level={announcement.level}
          className={cn(STRIP, LEVEL_STYLE[announcement.level].className)}
        >
          <span aria-hidden="true">{LEVEL_STYLE[announcement.level].glyph}</span>
          <span>{announcement[locale]}</span>
        </div>
      )}
    </>
  );
}

/**
 * `full` maintenance: the console is not usable, so it is not drawn. The
 * notice is polled, so the console comes back by itself when it ends.
 */
export function MaintenancePage(): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const { maintenance } = useNotice();
  return (
    <main
      data-testid="maintenance-page"
      className="auth-stage flex min-h-full items-center justify-center bg-canvas p-6 text-content"
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="brand-mark flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-base font-bold text-white"
          >
            S
          </span>
          <span className="text-lg font-semibold">{BASE_TITLE}</span>
        </div>
        <div className="auth-card flex flex-col gap-3 rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">{t('shell.maintenance.title')}</h1>
          <p className="text-sm text-content-secondary">
            {maintenance?.message?.[locale] ?? t('shell.maintenance.body')}
          </p>
          <p className="text-xs text-content-tertiary">{t('shell.maintenance.autoRetry')}</p>
        </div>
      </div>
    </main>
  );
}
