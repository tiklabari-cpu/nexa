/**
 * The customer-copy sentinel (tm 259.14, UX audit O7).
 *
 * Several descriptions the panel shows carried the repository's own bookkeeping
 * in parentheses — "(FR-MOD-12.2)", "(PRD §7.3.2)", "(ADR-13)" — which means
 * nothing to the person reading the page. Codes belong in code comments and
 * test titles, which no customer sees; this checks the *values* of every
 * catalogue, so a code that creeps back into a sentence fails here.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUES } from './index.js';

/**
 * Requirement ids (FR-MOD-07.4, FR-13-EK.3, NFR-S12, WORKSCHED-i), decision
 * records (ADR-09), PRD references (PRD §5.3, a bare §13.5) and task-master
 * references (tm 259.8).
 */
const INTERNAL_REF = /\b(?:N?FR-[A-Z0-9]|ADR-?\d|PRD\b|WORKSCHED|tm \d)|§\s*\d|\bNFR-[A-Z]/;

describe('panel locale values carry no internal requirement or decision codes', () => {
  for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
    it(`${locale}: 0 values match`, () => {
      const hits = Object.entries(catalogue)
        .filter(([, value]) => INTERNAL_REF.test(value))
        .map(([key, value]) => `${key}: ${value}`);
      expect(hits, `${hits.length} value(s) show an internal code`).toEqual([]);
    });
  }

  it('the pattern catches the shapes it is meant to', () => {
    for (const bad of [
      'Free (FR-MOD-04.6).',
      'Rated good (PRD §7.8).',
      'Mocked (ADR-13) — no card.',
      'See NFR-S12.',
      'Tracked sales §13.5',
      'Fixed in (tm 259.8)',
      'FR-13-EK.3',
    ]) {
      expect(INTERNAL_REF.test(bad), bad).toBe(true);
    }
    for (const fine of [
      'Bot accounts are free — a bot never uses a seat.',
      'Rated good as a share of all ratings.',
      'The AI Agent handled 4 chats.',
    ]) {
      expect(INTERNAL_REF.test(fine), fine).toBe(false);
    }
  });
});

/**
 * One name for a saved reply (UX audit D8): the menu says "Saved replies" /
 * "Kayıtlı yanıtlar", and the Home checklist and the audit log said "canned
 * response" / "hazır yanıt" for the same thing.
 */
describe('a saved reply is called a saved reply everywhere', () => {
  const OLD_NAME: Record<string, RegExp> = { en: /canned/i, tr: /hazır yanıt/i };

  for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
    const old = OLD_NAME[locale];
    if (!old) continue;
    it(`${locale}: 0 values use the old name`, () => {
      const hits = Object.entries(catalogue)
        // `{cannedResponses}` is a placeholder name, not copy anyone reads.
        .filter(([, value]) => old.test(value.replace(/\{[^}]*\}/g, '')))
        .map(([key, value]) => `${key}: ${value}`);
      expect(hits).toEqual([]);
    });
  }
});
