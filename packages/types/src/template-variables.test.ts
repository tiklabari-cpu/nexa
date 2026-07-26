import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_VARIABLES,
  findTemplateProblems,
  findTemplateProblemsIn,
  isTemplateValid,
  renderTemplate,
} from './template-variables.js';

/**
 * The property that carries FR-MOD-08.7.5's KK — "Geçersiz değişken/format
 * engeli". A template may only name a variable the product can fill, and only
 * through a well-formed `{{ … }}`; everything else is a problem the author is
 * shown before the template is stored. The renderer is the other side of the
 * same coin: a validated template fills cleanly, with no braces left behind.
 */
describe('ticket email template variables', () => {
  describe('rejects invalid variables (KK)', () => {
    it('flags an unknown variable', () => {
      const problems = findTemplateProblems('body', 'Hello {{customer.nam}}');
      expect(problems).toHaveLength(1);
      expect(problems[0]?.reason).toBe('unknown_variable');
    });

    it('flags an unknown variable in the subject too', () => {
      const problems = findTemplateProblemsIn({
        subject: 'Re: {{ticket.reference}}',
        body: 'Hi {{customer.name}}',
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]?.field).toBe('subject');
      expect(problems[0]?.reason).toBe('unknown_variable');
    });
  });

  describe('rejects malformed placeholders (KK)', () => {
    it.each([
      ['an empty placeholder', 'Hi {{}}'],
      ['a whitespace-only placeholder', 'Hi {{   }}'],
      ['an unclosed brace', 'Ticket {{ticket.id}'],
      ['a stray closing brace', 'Ticket ticket.id}}'],
      ['a nested placeholder', 'Hi {{ {{customer.name}} }}'],
      ['a bareword with no group', 'Hi {{ticket}}'],
    ])('flags %s', (_label, text) => {
      const problems = findTemplateProblems('body', text);
      expect(problems.some((p) => p.reason === 'malformed')).toBe(true);
    });
  });

  describe('accepts a valid template', () => {
    it('finds no problems when every variable is known and well formed', () => {
      const parts = {
        subject: 'Ticket {{ticket.id}} — {{ticket.subject}}',
        body: 'Hi {{customer.name}}, {{agent.name}} from {{company.name}} is on it.',
      };
      expect(findTemplateProblemsIn(parts)).toEqual([]);
      expect(isTemplateValid(parts)).toBe(true);
    });

    it('accepts plain text with no placeholders', () => {
      expect(findTemplateProblems('body', 'Thanks for reaching out.')).toEqual([]);
    });

    it('tolerates single braces used as literal text', () => {
      // A lone `{` or `}` is ordinary content (JSON, code) — only doubled,
      // placeholder-shaped braces are the feature's concern.
      expect(findTemplateProblems('body', 'Set { "a": 1 } in config.')).toEqual([]);
    });

    it('lists every catalogued variable as valid', () => {
      for (const variable of TEMPLATE_VARIABLES) {
        expect(findTemplateProblems('body', `x {{ ${variable} }} y`)).toEqual([]);
      }
    });
  });

  describe('renderTemplate', () => {
    it('substitutes known variables from the context', () => {
      const out = renderTemplate('Hi {{customer.name}}, ticket {{ticket.id}}.', {
        'customer.name': 'Ada',
        'ticket.id': 'T-42',
      });
      expect(out).toBe('Hi Ada, ticket T-42.');
    });

    it('renders a variable the context omits as empty, never as raw braces', () => {
      const out = renderTemplate('Hi {{customer.name}}!', {});
      expect(out).toBe('Hi !');
      expect(out).not.toContain('{{');
    });

    it('tolerates spacing inside the placeholder', () => {
      expect(renderTemplate('{{  ticket.id  }}', { 'ticket.id': 'T-7' })).toBe('T-7');
    });
  });
});
