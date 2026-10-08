/**
 * The catalogue's one hard promise: every template opens a skill the API will
 * accept. `POST /skills` runs `@siyahtus/ai-mock`'s `validateSteps`, and a template
 * whose steps failed it would turn "Use template" into a 400 the admin cannot
 * fix. `apps/web` is deliberately decoupled from `@siyahtus/ai-mock` (it mirrors
 * `SkillStep` in `types.ts`), so this test mirrors that validator's contract
 * here; `playbook.spec.ts` proves the real server end of it.
 */
import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '../../lib/i18n.js';
import {
  MAX_TEMPLATE_SUMMARY_LENGTH,
  RECOMMENDED_TEMPLATE_IDS,
  SKILL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  findCategoryMeta,
  findTemplate,
  recommendedTemplates,
  templateNameKey,
  templateSummaryKey,
  templateToDraft,
  templatesByCategory,
  type SkillTemplate,
  type TemplateCategory,
} from './templates.js';
import { TEMPLATE_TEXT_TR } from './templates-tr.js';
import type { SkillStep } from './types.js';

/** A faithful mirror of `@siyahtus/ai-mock` `validateStep`, kept in sync by intent. */
function stepIsValid(step: SkillStep): boolean {
  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  switch (step.type) {
    case 'detect_intent':
      return nonEmpty(step.intent) && (step.phrases === undefined || step.phrases.every(nonEmpty));
    case 'request_info':
      return nonEmpty(step.field) && nonEmpty(step.prompt);
    case 'tag':
      return nonEmpty(step.tag);
    case 'summarize':
      return true;
    case 'send_message':
      return step.source === 'knowledge' || (step.source === 'text' && nonEmpty(step.text));
    case 'transfer_to_team':
      return nonEmpty(step.group);
    default:
      return false;
  }
}

describe('skill template catalogue', () => {
  it('ships at least 31 templates — PRD §5.3 / 05.6-tmpl31 catalogue-size acceptance criterion', () => {
    expect(SKILL_TEMPLATES.length).toBeGreaterThanOrEqual(31);
  });

  it('gives every template a non-empty name, instruction and at least one step', () => {
    for (const template of SKILL_TEMPLATES) {
      expect(template.name.trim(), template.id).not.toBe('');
      expect(template.instruction.trim(), template.id).not.toBe('');
      expect(template.steps.length, template.id).toBeGreaterThan(0);
    }
  });

  it('only ships steps the API validator would accept', () => {
    for (const template of SKILL_TEMPLATES) {
      for (const [index, step] of template.steps.entries()) {
        expect(stepIsValid(step), `${template.id} step ${index + 1} (${step.type})`).toBe(true);
      }
    }
  });

  it('uses unique ids — required so 05.6-tmpl31-b can add 23+ records without a silent collision', () => {
    const seen = new Map<string, number>();
    for (const template of SKILL_TEMPLATES) {
      seen.set(template.id, (seen.get(template.id) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it(`keeps summary within ${MAX_TEMPLATE_SUMMARY_LENGTH} characters, so it reads as one card line`, () => {
    for (const template of SKILL_TEMPLATES) {
      expect(template.summary.length, template.id).toBeLessThanOrEqual(MAX_TEMPLATE_SUMMARY_LENGTH);
    }
  });

  it('populates every advertised category', () => {
    for (const category of TEMPLATE_CATEGORIES) {
      expect(templatesByCategory(category.id).length, category.id).toBeGreaterThan(0);
    }
  });

  it('has both integration-free and integration-required templates', () => {
    const needsIntegration = SKILL_TEMPLATES.filter((t) => t.requiresIntegration);
    const standalone = SKILL_TEMPLATES.filter((t) => !t.requiresIntegration);
    expect(needsIntegration.length).toBeGreaterThan(0);
    expect(standalone.length).toBeGreaterThan(0);
  });
});

describe('original eight templates (pre-05.6-tmpl31-b)', () => {
  const originalCategoryById: Record<string, TemplateCategory> = {
    'order-status': 'prebuilt',
    'returns-policy': 'prebuilt',
    'business-hours': 'prebuilt',
    'greet-and-route': 'ai',
    'collect-then-handover': 'ai',
    'shopify-order-lookup': 'trending',
    'stripe-refund': 'trending',
    'csat-followup': 'trending',
  };

  it('keeps every original id resolvable — adding 23+ records must not rename or drop one', () => {
    for (const id of Object.keys(originalCategoryById)) {
      expect(findTemplate(id), id).toBeDefined();
    }
  });

  it('keeps each original template in its original category', () => {
    for (const [id, category] of Object.entries(originalCategoryById)) {
      expect(findTemplate(id)?.category, id).toBe(category);
    }
  });
});

describe('badge', () => {
  const categoryIds: string[] = TEMPLATE_CATEGORIES.map((c) => c.id);

  it('is a card highlight distinct from category — a template never uses one to mean the other', () => {
    for (const template of SKILL_TEMPLATES) {
      if (template.badge === undefined) continue;
      expect(['popular', 'essential'], template.id).toContain(template.badge);
      expect(categoryIds, template.id).not.toContain(template.badge);
    }
  });
});

describe('catalogue i18n (NFR-I18N2)', () => {
  it('gives every template a TR and an EN entry for name and summary — a missing key fails this', () => {
    for (const template of SKILL_TEMPLATES) {
      expect(hasMessage('en', templateNameKey(template.id)), `${template.id} name (en)`).toBe(true);
      expect(hasMessage('tr', templateNameKey(template.id)), `${template.id} name (tr)`).toBe(true);
      expect(hasMessage('en', templateSummaryKey(template.id)), `${template.id} summary (en)`).toBe(
        true,
      );
      expect(hasMessage('tr', templateSummaryKey(template.id)), `${template.id} summary (tr)`).toBe(
        true,
      );
    }
  });

  it('keeps the English catalogue entry in sync with the template’s literal name/summary', () => {
    for (const template of SKILL_TEMPLATES) {
      expect(translate('en', templateNameKey(template.id)), template.id).toBe(template.name);
      expect(translate('en', templateSummaryKey(template.id)), template.id).toBe(template.summary);
    }
  });

  it('actually translates into Turkish rather than leaning on the key/English fallback', () => {
    for (const template of SKILL_TEMPLATES) {
      const nameKey = templateNameKey(template.id);
      const summaryKey = templateSummaryKey(template.id);
      expect(translate('tr', nameKey), template.id).not.toBe(nameKey);
      expect(translate('tr', summaryKey), template.id).not.toBe(summaryKey);
    }
  });

  it('leaves instruction/steps out of the i18n catalogue — a deliberate boundary, not an oversight', () => {
    // `instruction` is what the AI reads; translating it would change what the
    // skill does, not just how it reads on a card. Guard both ends: no
    // `.instruction` key exists, and the literal field is prose, not a key.
    for (const template of SKILL_TEMPLATES) {
      const instructionKey = `playbook.template.${template.id}.instruction`;
      expect(hasMessage('en', instructionKey), template.id).toBe(false);
      expect(hasMessage('tr', instructionKey), template.id).toBe(false);
      expect(template.instruction.startsWith('playbook.template.'), template.id).toBe(false);
    }
  });

  it('changes gallery text with locale without touching template behaviour', () => {
    const template = findTemplate('order-status') as SkillTemplate;
    const englishName = translate('en', templateNameKey(template.id));
    const turkishName = translate('tr', templateNameKey(template.id));
    expect(turkishName).not.toBe(englishName);

    // The behavioural payload — instruction and steps — does not take a locale
    // and so cannot vary with one; drafting from the template is identical
    // regardless of which language the gallery happens to be showing.
    const draft = templateToDraft(template);
    expect(draft.instruction).toBe(template.instruction);
    expect(draft.steps).toEqual(template.steps);
  });
});

describe('recommendedTemplates', () => {
  it('resolves every featured id against the catalogue', () => {
    const templates = recommendedTemplates();
    expect(templates).toHaveLength(RECOMMENDED_TEMPLATE_IDS.length);
    expect(templates.every((t) => t !== undefined)).toBe(true);
  });

  it('preserves the featured order', () => {
    expect(recommendedTemplates().map((t) => t.id)).toEqual([...RECOMMENDED_TEMPLATE_IDS]);
  });

  it('spans all three categories, so the strip advertises each kind', () => {
    const categories = new Set(recommendedTemplates().map((t) => t.category));
    for (const category of TEMPLATE_CATEGORIES) {
      expect(categories.has(category.id), category.id).toBe(true);
    }
  });

  it('features at least one integration-required card, so the strip carries a warning', () => {
    expect(recommendedTemplates().some((t) => t.requiresIntegration)).toBe(true);
  });

  it('drops ids that no longer resolve rather than leaving a hole', () => {
    // The public helper only surfaces real templates: its length equals the count
    // of ids that map to a catalogue entry, never the raw id-list length blindly.
    const resolvable = RECOMMENDED_TEMPLATE_IDS.filter((id) => findTemplate(id));
    expect(recommendedTemplates()).toHaveLength(resolvable.length);
  });
});

describe('findCategoryMeta', () => {
  it('returns the icon and label for every advertised category', () => {
    for (const category of TEMPLATE_CATEGORIES) {
      expect(findCategoryMeta(category.id)).toEqual(category);
    }
  });
});

describe('templateToDraft', () => {
  const template = findTemplate('order-status') as SkillTemplate;

  it('carries the template name, instruction and steps into a draft', () => {
    const draft = templateToDraft(template);
    expect(draft.name).toBe(template.name);
    expect(draft.instruction).toBe(template.instruction);
    expect(draft.steps).toEqual(template.steps);
  });

  it('deep-copies steps so an editor cannot mutate the shared catalogue', () => {
    const draft = templateToDraft(template);
    (draft.steps[0] as { intent?: string }).intent = 'changed';
    expect((template.steps[0] as { intent?: string }).intent).not.toBe('changed');
  });
});

/**
 * D18 (tm 259.18): a template picked in a Turkish console mints a Turkish
 * skill. The words are `templates-tr.ts`; everything the engine matches on is
 * the catalogue's own, and these pin the line between the two.
 */
describe('templateToDraft in Turkish', () => {
  const tr = (template: SkillTemplate) => templateToDraft(template, 'tr');

  it('is the catalogue as authored in English, by default and by name', () => {
    const template = findTemplate('order-status') as SkillTemplate;
    expect(templateToDraft(template)).toEqual(templateToDraft(template, 'en'));
    expect(templateToDraft(template).instruction).toBe(template.instruction);
  });

  it('has text for every template, one entry per step', () => {
    for (const template of SKILL_TEMPLATES) {
      const text = TEMPLATE_TEXT_TR[template.id];
      expect(text, `${template.id} has no Turkish text`).toBeDefined();
      expect(text!.steps, `${template.id} step count`).toHaveLength(template.steps.length);
    }
    expect(Object.keys(TEMPLATE_TEXT_TR).sort()).toEqual(SKILL_TEMPLATES.map((t) => t.id).sort());
  });

  it('only supplies words a step of that type can carry', () => {
    for (const template of SKILL_TEMPLATES) {
      template.steps.forEach((step, index) => {
        const text = TEMPLATE_TEXT_TR[template.id]!.steps[index]!;
        const where = `${template.id}[${index}] (${step.type})`;
        if (text.phrases) expect(step.type, where).toBe('detect_intent');
        if (text.prompt) expect(step.type, where).toBe('request_info');
        if (text.text) {
          expect(step.type, where).toBe('send_message');
          expect((step as { source: string }).source, where).toBe('text');
        }
      });
    }
  });

  it('leaves what the engine and the workspace match on exactly as authored', () => {
    for (const template of SKILL_TEMPLATES) {
      const draft = tr(template);
      expect(draft.steps).toHaveLength(template.steps.length);
      draft.steps.forEach((step, index) => {
        const original = template.steps[index]!;
        const where = `${template.id}[${index}]`;
        expect(step.type, where).toBe(original.type);
        // Identifiers: the intent, the collected field, the tag, the team name
        // and where a reply comes from are not words to translate.
        for (const key of ['intent', 'field', 'tag', 'group', 'source'] as const) {
          expect((step as unknown as Record<string, unknown>)[key], `${where}.${key}`).toBe(
            (original as unknown as Record<string, unknown>)[key],
          );
        }
      });
    }
  });

  it('opens skills the API will accept, as the English ones do', () => {
    for (const template of SKILL_TEMPLATES) {
      for (const step of tr(template).steps) expect(stepIsValid(step), template.id).toBe(true);
    }
  });

  it('has really been translated: name from the catalogue, instruction and every question and reply Turkish', () => {
    for (const template of SKILL_TEMPLATES) {
      const draft = tr(template);
      expect(draft.name, template.id).toBe(translate('tr', templateNameKey(template.id)));
      expect(draft.name, template.id).not.toBe(template.name);
      expect(draft.instruction, template.id).not.toBe(template.instruction);

      // The Spanish greeting is Spanish on purpose; everything else must differ.
      if (template.id === 'multilingual-greeting') continue;
      draft.steps.forEach((step, index) => {
        const original = template.steps[index]!;
        const where = `${template.id}[${index}]`;
        if (step.type === 'request_info') {
          expect(step.prompt, where).not.toBe((original as { prompt: string }).prompt);
        }
        if (step.type === 'send_message' && step.source === 'text') {
          expect(step.text, where).not.toBe((original as { text?: string }).text);
        }
        if (step.type === 'detect_intent' && original.type === 'detect_intent') {
          expect(step.phrases?.length, where).toBeGreaterThan(0);
          for (const phrase of step.phrases ?? []) {
            expect(original.phrases ?? [], `${where} "${phrase}"`).not.toContain(phrase);
          }
        }
      });
    }
  });

  it('quotes in its instruction the very reply it sends, as the English instruction does', () => {
    for (const template of SKILL_TEMPLATES) {
      const draft = tr(template);
      template.steps.forEach((step, index) => {
        if (step.type !== 'send_message' || step.source !== 'text') return;
        if (!template.instruction.includes(`"${step.text}"`)) return;
        const sent = (draft.steps[index] as { text: string }).text;
        expect(draft.instruction, template.id).toContain(`"${sent}"`);
      });
    }
  });

  it('keeps the catalogue untouched: a Turkish draft is a copy', () => {
    const template = findTemplate('order-status') as SkillTemplate;
    const draft = tr(template);
    (draft.steps[1] as { prompt: string }).prompt = 'changed';
    expect((template.steps[1] as { prompt: string }).prompt).toBe('What is your order number?');
    expect(TEMPLATE_TEXT_TR['order-status']!.steps[1]!.prompt).not.toBe('changed');
  });
});
