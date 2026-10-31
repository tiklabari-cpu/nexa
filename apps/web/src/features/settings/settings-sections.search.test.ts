/**
 * `searchSections` after IN-11: Turkish folding on both sides, Turkish keywords
 * for the sections an agent looks for by a Turkish word, and the ranking
 * label start > label inside > keyword.
 */
import { describe, expect, it } from 'vitest';
import { defaultScopesForRole } from '@siyahtus/types';
import { searchSections, type SettingsSectionEntry } from './settings-sections.js';

/** The Turkish labels the catalogue renders, for the sections these tests read. */
const TR_LABELS: Record<string, string> = {
  'two-factor': 'İki adımlı doğrulama',
  'canned-responses': 'Kayıtlı yanıtlar',
  'sensitive-data': 'Hassas veri',
  profile: 'Profilim',
  sla: 'SLA',
};
const trLabel = (entry: SettingsSectionEntry): string => TR_LABELS[entry.slug] ?? entry.slug;

const OWNER = defaultScopesForRole('owner');
const AGENT = defaultScopesForRole('agent');
const slugs = (scopes: readonly string[], query: string): string[] =>
  searchSections(scopes, query, trLabel).map((s) => s.slug);

describe('searchSections — Turkish folding (IN-11)', () => {
  it('finds "İki adımlı doğrulama" by "iki", "IKI", "İKİ" and "iki adimli"', () => {
    for (const query of ['iki', 'IKI', 'İKİ', 'iki adimli', 'İki adımlı']) {
      expect(slugs(AGENT, query)).toContain('two-factor');
    }
  });

  it('finds the password sections by "sifre" and "şifre" alike', () => {
    for (const query of ['sifre', 'ŞİFRE', 'şifre']) {
      expect(slugs(OWNER, query)).toEqual(expect.arrayContaining(['profile', 'sensitive-data']));
    }
  });

  it('finds Saved replies by the spec name "hazır" / "hazir", and by "kısayol" and "yanıt"', () => {
    for (const query of ['hazır', 'HAZIR', 'hazir', 'kısayol', 'kisayol', 'yanıt']) {
      expect(slugs(OWNER, query)).toContain('canned-responses');
    }
  });

  it('finds the service-level section by "mesai"', () => {
    expect(slugs(OWNER, 'mesai')).toContain('sla');
  });
});

describe('searchSections — gating and order', () => {
  it('shows a member none of the owner-only security sections', () => {
    expect(slugs(AGENT, 'saml')).not.toContain('sso');
    expect(slugs(AGENT, 'hassas')).not.toContain('sensitive-data');
    // …while the owner reaches them with the same words.
    expect(slugs(OWNER, 'saml')).toContain('sso');
    expect(slugs(OWNER, 'hassas')).toContain('sensitive-data');
  });

  it('ranks a label start before a label inside before a keyword', () => {
    const labels: Record<string, string> = { tags: 'Zeta', sla: 'Alpha zeta', profile: 'Beta' };
    const labelOf = (e: SettingsSectionEntry): string => labels[e.slug] ?? e.slug;
    // "zeta": tags starts with it, sla holds it, profile has no hit — and `profile`
    // comes first in navigation order, `sla` before `tags`, so only the rank can
    // put tags in front.
    const ranked = searchSections(OWNER, 'zeta', labelOf).map((s) => s.slug);
    expect(ranked).toEqual(['tags', 'sla']);
  });

  it('puts a keyword-only hit after a label hit, though it comes first in navigation', () => {
    // `profile` (keyword "password") precedes `sensitive-data` in navigation order.
    const labelOf = (e: SettingsSectionEntry): string =>
      e.slug === 'sensitive-data' ? 'Password masking' : e.slug;
    const ranked = searchSections(OWNER, 'password', labelOf).map((s) => s.slug);
    expect(ranked.indexOf('sensitive-data')).toBeLessThan(ranked.indexOf('profile'));
  });
});
