/**
 * Panel font presets (owner, 2026-10-13) — the runtime half: narrowing, the
 * storage key, painting the server's answer, and the boot script's copy of
 * both (theme.test.ts's pattern: a drift there is a flash of the wrong font on
 * every load and nothing else).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PANEL_FONT_PRESETS, type PanelAppearance } from '@siyahtus/types';
import { coerceFont, detectFont, fontSourceText, FONT_STORAGE_KEY, useFontStore } from './font.js';

const APPEARANCE: PanelAppearance = {
  effective_font_preset: 'figtree',
  source: 'workspace',
  workspace_font_preset: 'figtree',
  workspace_font_preset_set_at: '2026-10-12T09:00:00.000Z',
  user_font_preset: null,
  user_font_preset_set_at: null,
};

afterEach(() => {
  localStorage.clear();
  useFontStore.getState().setAppearance(undefined);
});

describe('coerceFont / detectFont', () => {
  it('keeps a catalogue key and turns anything else into Inter', () => {
    for (const preset of PANEL_FONT_PRESETS) expect(coerceFont(preset)).toBe(preset);
    for (const value of [null, undefined, '', 'Figtree', 'comic-sans']) {
      expect(coerceFont(value)).toBe('inter');
    }
  });

  it('reads the remembered key', () => {
    localStorage.setItem(FONT_STORAGE_KEY, 'nunito');
    expect(detectFont()).toBe('nunito');
    expect(FONT_STORAGE_KEY).toBe('siyahtus.font');
  });
});

describe('painting the server answer', () => {
  it('sets data-font, remembers it, and keeps the answer', () => {
    useFontStore.getState().setAppearance(APPEARANCE);
    expect(document.documentElement.dataset.font).toBe('figtree');
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe('figtree');
    expect(useFontStore.getState().appearance).toEqual(APPEARANCE);
  });

  it('paints Inter for an older server that sends no appearance', () => {
    useFontStore.getState().setAppearance(APPEARANCE);
    useFontStore.getState().setAppearance(undefined);
    expect(document.documentElement.dataset.font).toBe('inter');
    expect(useFontStore.getState().appearance).toBeNull();
  });

  it('says where the font comes from', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      `${key}${params ? JSON.stringify(params) : ''}`;
    expect(fontSourceText(t, null)).toBe(
      'shell.account.font.source.builtin{"font":"shell.font.inter"}',
    );
    expect(fontSourceText(t, APPEARANCE)).toMatch(
      /^shell\.account\.font\.source\.workspace\{"font":"shell\.font\.figtree","date":".+"\}$/,
    );
  });
});

describe('the pre-paint boot script in index.html', () => {
  const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  it('reads the same storage key', () => {
    expect(INDEX_HTML).toContain(`localStorage.getItem('${FONT_STORAGE_KEY}')`);
  });

  it('accepts exactly the non-default presets', () => {
    const list = INDEX_HTML.match(/\[('[a-z-]+'(?:, '[a-z-]+')*)\]\.indexOf\(font\)/);
    expect(list).not.toBeNull();
    const keys = list![1]!.split(', ').map((k) => k.slice(1, -1));
    expect(keys).toEqual(PANEL_FONT_PRESETS.filter((p) => p !== 'inter'));
  });
});
