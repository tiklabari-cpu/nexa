/**
 * "Latest wins" for the panel font (owner, 2026-10-13): the six cases of the
 * rule, plus the two edges the stored data can still present.
 */
import { describe, expect, it } from 'vitest';
import { panelAppearance, resolvePanelFontPreset, type FontChoice } from './panel-font.js';

const T1 = new Date('2026-10-12T09:00:00.000Z');
const T2 = new Date('2026-10-12T10:00:00.000Z');
const T3 = new Date('2026-10-12T11:00:00.000Z');
const choice = (preset: string, setAt: Date): FontChoice => ({ preset, setAt });
const cleared: FontChoice = { preset: null, setAt: null };

describe('resolvePanelFontPreset', () => {
  it('neither layer chose: the built-in Inter', () => {
    expect(resolvePanelFontPreset({ workspace: null, user: null })).toEqual({
      effective_font_preset: 'inter',
      source: 'builtin',
    });
  });

  it('only the workspace chose: its default', () => {
    expect(resolvePanelFontPreset({ workspace: choice('figtree', T1), user: null })).toEqual({
      effective_font_preset: 'figtree',
      source: 'workspace',
    });
  });

  it('only the member chose: their choice', () => {
    expect(resolvePanelFontPreset({ workspace: null, user: choice('nunito', T1) })).toEqual({
      effective_font_preset: 'nunito',
      source: 'user',
    });
  });

  it('the workspace default is newer: it wins over the older choice', () => {
    expect(
      resolvePanelFontPreset({
        workspace: choice('manrope-dm-sans', T3),
        user: choice('nunito', T2),
      }),
    ).toEqual({ effective_font_preset: 'manrope-dm-sans', source: 'workspace' });
  });

  it('the member chose after the default: their choice wins', () => {
    expect(
      resolvePanelFontPreset({ workspace: choice('figtree', T1), user: choice('nunito', T2) }),
    ).toEqual({ effective_font_preset: 'nunito', source: 'user' });
  });

  it('the member cleared their choice: the workspace default again', () => {
    expect(resolvePanelFontPreset({ workspace: choice('figtree', T1), user: cleared })).toEqual({
      effective_font_preset: 'figtree',
      source: 'workspace',
    });
    expect(resolvePanelFontPreset({ workspace: cleared, user: cleared }).source).toBe('builtin');
  });

  it('an exact tie goes to the member, the more specific layer', () => {
    expect(
      resolvePanelFontPreset({ workspace: choice('figtree', T2), user: choice('nunito', T2) })
        .source,
    ).toBe('user');
  });

  it('a key the catalogue does not know counts as no choice', () => {
    expect(
      resolvePanelFontPreset({ workspace: choice('comic-sans', T3), user: choice('nunito', T1) }),
    ).toEqual({ effective_font_preset: 'nunito', source: 'user' });
  });
});

describe('panelAppearance', () => {
  it('carries both layers beside the answer', () => {
    expect(
      panelAppearance({ workspace: choice('figtree', T1), user: choice('nunito', T2) }),
    ).toEqual({
      effective_font_preset: 'nunito',
      source: 'user',
      workspace_font_preset: 'figtree',
      workspace_font_preset_set_at: T1.toISOString(),
      user_font_preset: 'nunito',
      user_font_preset_set_at: T2.toISOString(),
    });
  });
});
