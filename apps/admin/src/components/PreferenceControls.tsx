/**
 * Language and theme switchers, small enough to sit in the PLATFORM strip (tm 389.6).
 * Shared by the signed-in shell and the sign-in pages: an operator picks a language before
 * they sign in as often as after.
 */
import type { ReactElement } from 'react';
import { LOCALE_NAMES, LOCALES, useLocale, useTranslate, type Locale } from '../lib/i18n.js';
import { THEME_NAMES, THEMES, useTheme, type Theme } from '../lib/theme.js';

const SELECT_CLASS =
  'rounded border border-strip-text/50 bg-transparent px-1.5 py-0.5 text-xs text-strip-text';

export function PreferenceControls(): ReactElement {
  const t = useTranslate();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  return (
    <>
      <label className="flex items-center gap-1 text-xs">
        <span className="sr-only">{t('shell.account.language')}</span>
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          className={SELECT_CLASS}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code} className="bg-surface text-content">
              {LOCALE_NAMES[code]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs">
        <span className="sr-only">{t('shell.account.theme')}</span>
        <select
          value={theme}
          onChange={(event) => setTheme(event.target.value as Theme)}
          className={SELECT_CLASS}
        >
          {THEMES.map((name) => (
            <option key={name} value={name} className="bg-surface text-content">
              {t(THEME_NAMES[name])}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
