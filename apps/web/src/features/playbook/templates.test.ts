/**
 * The catalogue's one hard promise: every template opens a skill the API will
 * accept. `POST /skills` runs `@nexa/ai-mock`'s `validateSteps`, and a template
 * whose steps failed it would turn "Use template" into a 400 the admin cannot
 * fix. `apps/web` is deliberately decoupled from `@nexa/ai-mock` (it mirrors
 * `SkillStep` in `types.ts`), so this test mirrors that validator's contract
 * here; `playbook.spec.ts` proves the real server end of it.
 */
import { describe, expect, it } from 'vitest';
import {
  RECOMMENDED_TEMPLATE_IDS,
  SKILL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  findCategoryMeta,
  findTemplate,
  recommendedTemplates,
  templateToDraft,
  templatesByCategory,
  type SkillTemplate,
} from './templates.js';
import type { SkillStep } from './types.js';

/** A faithful mirror of `@nexa/ai-mock` `validateStep`, kept in sync by intent. */
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

  it('uses unique ids', () => {
    const ids = SKILL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
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
