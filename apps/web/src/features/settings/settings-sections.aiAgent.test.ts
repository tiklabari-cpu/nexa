/**
 * Settings › AI Agent (tm 390.2) is a door to Playbook, not a screen: it links
 * to the General tab, is hidden from whoever cannot open the Playbook, and is
 * found by the words an admin types for it — in English and in Turkish.
 */
import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SECTIONS,
  searchSections,
  sectionHref,
  visibleSections,
} from './settings-sections.js';

const labelOf = (entry: { slug: string }): string =>
  entry.slug === 'ai-agent' ? 'AI Agent' : entry.slug;

describe('Settings › AI Agent entry', () => {
  const entry = SETTINGS_SECTIONS.find((section) => section.slug === 'ai-agent');

  it('links to the General tab of Playbook and owns no section file', () => {
    expect(entry).toBeDefined();
    expect(sectionHref(entry!)).toBe('/app/playbook?view=general');
    expect(entry!.file).toBeUndefined();
  });

  it('is gated like the Playbook rail entry', () => {
    expect(visibleSections(['agents-bot--all:rw']).some((s) => s.slug === 'ai-agent')).toBe(true);
    expect(visibleSections(['agents-bot--all:ro']).some((s) => s.slug === 'ai-agent')).toBe(true);
    expect(visibleSections(['chats--all:ro']).some((s) => s.slug === 'ai-agent')).toBe(false);
  });

  it('is found by "AI agent" and by the Turkish "yapay zeka" / "yapay zekâ"', () => {
    const scopes = ['agents-bot--all:rw'];
    for (const query of ['ai agent', 'yapay zeka', 'yapay zekâ']) {
      expect(searchSections(scopes, query, labelOf).map((s) => s.slug)).toContain('ai-agent');
    }
  });
});
