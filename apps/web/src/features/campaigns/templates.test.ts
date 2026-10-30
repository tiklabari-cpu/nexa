/**
 * The template gallery's catalogue (EN-05 · tm 354): every template is a draft
 * the API would accept as it stands, reads in both panel languages, and a
 * promotion is marked as one.
 */
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RULES_MAX,
  campaignRuleProblem,
  normalizeRichCard,
  richCardProblems,
} from '@siyahtus/types';
import { CATALOGUES } from '../../locales/index.js';
import { cardProblems } from './CampaignCardEditor.js';
import {
  CAMPAIGN_TEMPLATES,
  CAMPAIGN_TEMPLATE_CATEGORIES,
  templateDraft,
  templatesIn,
} from './templates.js';

const lookup = (locale: 'en' | 'tr') => (key: string) => {
  const text = (CATALOGUES[locale] as Record<string, string>)[key];
  if (text === undefined) throw new Error(`${locale} is missing ${key}`);
  return text;
};

describe('campaign templates (EN-05)', () => {
  it('has ids that are unique and every category is stocked', () => {
    expect(new Set(CAMPAIGN_TEMPLATES.map((template) => template.id)).size).toBe(
      CAMPAIGN_TEMPLATES.length,
    );
    for (const category of CAMPAIGN_TEMPLATE_CATEGORIES) {
      expect(templatesIn(category).length, category).toBeGreaterThan(0);
    }
  });

  it.each(['en', 'tr'] as const)(
    'reads in %s: name, description and the message are all there',
    (locale) => {
      const t = lookup(locale);
      for (const template of CAMPAIGN_TEMPLATES) {
        expect(t(`campaigns.template.${template.id}.description`).length).toBeGreaterThan(0);
        const draft = templateDraft(template, t);
        expect(draft.name.length, template.id).toBeGreaterThan(0);
        expect(draft.name.length, template.id).toBeLessThanOrEqual(120);
      }
    },
  );

  it('gives every template a trigger the API accepts and something to say', () => {
    const t = lookup('tr');
    for (const template of CAMPAIGN_TEMPLATES) {
      const draft = templateDraft(template, t);
      const rules = draft.conditions.rules ?? [];
      expect(rules.length, template.id).toBeGreaterThan(0);
      expect(rules.length, template.id).toBeLessThanOrEqual(CAMPAIGN_RULES_MAX);
      for (const rule of rules) expect(campaignRuleProblem(rule), template.id).toBeNull();

      if (draft.content.type === 'card') {
        const card = normalizeRichCard(draft.content.card);
        expect(richCardProblems(card, { source: 'campaign' }), template.id).toEqual([]);
        expect(cardProblems(draft.content.card!), template.id).toEqual([]);
      } else {
        expect(draft.content.message?.trim().length, template.id).toBeGreaterThan(0);
        // CAMPAIGN_MESSAGE_MAX
        expect(draft.content.message!.length, template.id).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('marks the promotions, and keeps a responsible-play line on each (EN-01)', () => {
    const promotions = CAMPAIGN_TEMPLATES.filter((template) => template.category === 'promotion');
    expect(promotions.length).toBeGreaterThan(0);
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(template.kind === 'promotion', template.id).toBe(template.category === 'promotion');
    }
    const t = lookup('tr');
    for (const template of promotions) {
      expect(templateDraft(template, t).content.message, template.id).toMatch(/limit/i);
    }
  });

  it('hands the builder its own copy of the rules, not the shared ones', () => {
    const template = CAMPAIGN_TEMPLATES[0]!;
    const draft = templateDraft(template, lookup('en'));
    draft.conditions.rules![0]!.value = 'changed';
    expect(template.rules[0]!.value).not.toBe('changed');
  });
});
