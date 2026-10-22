/**
 * Settings → Notifications (FR-MOD-13.8 · 13.7-c).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-e, tm
 * 133.5): the i18n coverage sentinel (`i18n-coverage.test.ts`) claims a whole
 * *file* as translated, and `SettingsPage.tsx` carries a couple of dozen other
 * sections I18N-i/j (tm 133.9, 133.10) still owns in English. Splitting this
 * section out lets it register and pass the sentinel on its own, without
 * claiming — or blocking — the rest of that page.
 *
 * The section stopped being a browser preference form when push arrived: it now
 * reads the account and writes to it. Three things that change makes worth
 * pinning without a real browser —
 *
 *   - **It renders at all.** The store holds the preferences as an object, and
 *     zustand v5 compares a selector's result with `Object.is`; normalising
 *     inside the selector hands back a new identity every render and takes the
 *     whole Settings page down in a loop. The e2e suite caught that once. This
 *     catches it in a second rather than fourteen minutes, and does it by
 *     rendering with a store that updates.
 *   - **A toggle sends only what moved.** The endpoint takes a partial body, and
 *     a screen that restated all five would overwrite a channel a second tab had
 *     just changed.
 *   - **The master switch does not reach e-mail.** That is the one rule in this
 *     surface a reader is likely to assume the other way round.
 *
 * Every row is the person's *own* preference, so it is the one section built
 * on `InstantToggle` rather than a Save button (tm 323.2 · GV-06): it writes the
 * moment it is flipped, says "Saved" with an Undo, and a refused write puts
 * the switch back.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Card, Section } from '../../components/Page.js';
import { InstantToggle } from '../../components/settings/InstantToggle.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { type Permission } from '../notifications/notifications.js';
import { readNotificationPreferences, type NotificationPreferences } from '@siyahtus/types';
import {
  currentPermission,
  requestNotificationPermission,
} from '../notifications/useNotifications.js';

export function NotificationSettings(): ReactElement {
  const t = useTranslate();
  const [permission, setPermission] = useState<Permission>('default');

  // Selected as the stored reference and normalised outside the selector. Zustand
  // v5 compares the selector's result with `Object.is`, so building the object
  // inside it would hand back a new identity on every render — an infinite loop
  // that takes the whole Settings page down, not a stale value.
  const stored = useAuth((s) => s.agent?.notification_preferences);
  const prefs = useMemo(() => readNotificationPreferences(stored), [stored]);
  const setPreferences = useAuth((s) => s.setNotificationPreferences);

  // The permission is read once on mount — `Notification.permission` is a
  // browser global, not a render-time value.
  useEffect(() => {
    setPermission(currentPermission());
  }, []);

  /** Rejects when the write is refused, so the toggle goes back and says so. */
  function update(patch: Partial<NotificationPreferences>): Promise<void> {
    return setPreferences(patch);
  }

  async function enableDesktop(): Promise<void> {
    const result = await requestNotificationPermission();
    setPermission(result);
    // Turning the desktop toggle on is pointless if the browser refuses; keep
    // the stored preference honest about what will actually happen.
    if (result === 'granted') await update({ desktop: true }).catch(() => undefined);
  }

  const desktopBlocked = permission === 'denied' || permission === 'unsupported';

  return (
    <Section
      title={t('team.notifications.title')}
      description={t('team.notifications.description')}
    >
      <Card>
        <div className="flex flex-col gap-3 p-4">
          <InstantToggle
            label={t('team.notifications.enable.label')}
            description={t('team.notifications.enable.hint')}
            checked={prefs.enabled}
            onChange={(enabled) => update({ enabled })}
          />

          <InstantToggle
            label={t('team.notifications.sound.label')}
            description={t('team.notifications.sound.hint')}
            checked={prefs.sound}
            disabled={!prefs.enabled}
            onChange={(sound) => update({ sound })}
          />

          <div className="flex flex-wrap items-center gap-3">
            <InstantToggle
              label={t('team.notifications.desktop.label')}
              description={
                permission === 'granted'
                  ? t('team.notifications.desktop.granted')
                  : permission === 'denied'
                    ? t('team.notifications.desktop.denied')
                    : permission === 'unsupported'
                      ? t('team.notifications.desktop.unsupported')
                      : t('team.notifications.desktop.default')
              }
              checked={prefs.desktop && permission === 'granted'}
              disabled={!prefs.enabled || desktopBlocked}
              onChange={(desktop) => update({ desktop })}
            />

            {prefs.enabled && permission !== 'granted' && permission !== 'unsupported' && (
              <button
                type="button"
                onClick={() => void enableDesktop()}
                disabled={permission === 'denied'}
                className="rounded-md border border-border px-3 py-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {t('team.notifications.desktop.enableButton')}
              </button>
            )}
          </div>

          <InstantToggle
            label={t('team.notifications.push.label')}
            description={t('team.notifications.push.hint')}
            checked={prefs.push}
            disabled={!prefs.enabled}
            onChange={(push) => update({ push })}
          />

          <InstantToggle
            label={t('team.notifications.email.label')}
            description={t('team.notifications.email.hint')}
            checked={prefs.email}
            onChange={(email) => update({ email })}
          />
        </div>
      </Card>
    </Section>
  );
}
