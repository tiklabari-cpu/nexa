/**
 * The account menu's font picker (owner, 2026-10-13): "Workspace default" or
 * one of the five presets, each option drawn in its own face.
 *
 * A pick is painted at once and saved to the caller's own preferences; the
 * server's resolved answer then replaces it (`useAuth().setFontPreset`). The
 * note under it says where the font on screen comes from, because "the latest
 * choice wins" is otherwise invisible: an owner changing the default later
 * outranks an older pick here.
 */
import { useState, type ReactElement } from 'react';
import { PANEL_FONT_DESIGNS, PANEL_FONT_PRESETS, type PanelFontPreset } from '@siyahtus/types';
import { useAuth } from '../lib/auth-store.js';
import { fontNameKey, fontSourceText, loadAllFontFiles, useFontStore } from '../lib/font.js';
import { useTranslate } from '../lib/i18n.js';

/** The select's value for "no choice of my own". */
const WORKSPACE_DEFAULT = '';

export function FontPicker(): ReactElement {
  const t = useTranslate();
  const appearance = useFontStore((s) => s.appearance);
  const setFontPreset = useAuth((s) => s.setFontPreset);
  const [failed, setFailed] = useState(false);

  // Whatever the member chose, even when the workspace default outranks it.
  const chosen = appearance?.user_font_preset ?? WORKSPACE_DEFAULT;

  return (
    <div className="mt-3">
      <label className="block text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('shell.account.font')}
        <select
          value={chosen}
          // The options preview their own faces, so their files are needed —
          // but only once someone reaches for the list. The account menu is
          // rendered (hidden) on every page; loading all six families on mount
          // would download them on every load for everyone.
          onFocus={() => void loadAllFontFiles()}
          onPointerDown={() => void loadAllFontFiles()}
          onChange={(event) => {
            const value = event.target.value;
            setFailed(false);
            setFontPreset(value === WORKSPACE_DEFAULT ? null : (value as PanelFontPreset)).catch(
              () => setFailed(true),
            );
          }}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm normal-case tracking-normal text-content"
        >
          <option value={WORKSPACE_DEFAULT}>{t('shell.account.font.workspaceDefault')}</option>
          {PANEL_FONT_PRESETS.map((preset) => (
            <option
              key={preset}
              value={preset}
              lang="en"
              style={{ fontFamily: PANEL_FONT_DESIGNS[preset].heading }}
            >
              {t(fontNameKey(preset))}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-2xs text-content-tertiary" data-testid="font-source">
        {fontSourceText(t, appearance)}
      </p>
      {failed && (
        <p role="alert" className="mt-1 text-2xs text-danger">
          {t('shell.account.font.saveError')}
        </p>
      )}
    </div>
  );
}
