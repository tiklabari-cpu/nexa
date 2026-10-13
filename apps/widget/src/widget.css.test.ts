/**
 * The widget's stylesheet still parses into the rules it is written as.
 *
 * Added after a restyle left one section heading's comment unclosed: the
 * browser read everything up to the next `*\/` as comment and silently dropped
 * the `.nx-panel` rule with it, so the open panel lost its position, size and
 * corners. No other test could see it — jsdom does no layout, and every
 * behaviour test passed — so the parse itself is asserted here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mount } from './widget.js';

let css = '';
let selectors: string[] = [];

beforeAll(() => {
  window.history.replaceState({}, '', '/widget.html?organization_id=org-1');
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  const style = document.head.querySelector('style')!;
  css = style.textContent ?? '';
  const walk = (rules: CSSRuleList): string[] =>
    [...rules].flatMap((rule) =>
      'cssRules' in rule && !(rule instanceof CSSStyleRule)
        ? walk((rule as CSSGroupingRule).cssRules)
        : rule instanceof CSSStyleRule
          ? [rule.selectorText]
          : [],
    );
  selectors = walk(style.sheet!.cssRules);
});

describe('widget stylesheet', () => {
  it('opens and closes every comment', () => {
    const opens = css.match(/\/\*/g)?.length ?? 0;
    const closes = css.match(/\*\//g)?.length ?? 0;
    expect(closes).toBe(opens);
  });

  it.each([
    '.nx-launcher',
    '.nx-greeting',
    '.nx-preview',
    '.nx-panel',
    '.nx-header',
    '.nx-team > span',
    '.nx-transcript',
    '.nx-prechat',
    '.nx-form',
    '.nx-powered',
  ])('parses the %s rule', (selector) => {
    expect(selectors).toContain(selector);
  });
});

describe('widget open state (owner, 2026-10-13)', () => {
  it('keeps the launcher on screen as the close button while the panel is open', () => {
    const launcher = document.querySelector<HTMLButtonElement>('.nx-launcher')!;
    launcher.click();
    expect(document.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(false);
    expect(launcher.hidden).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    // No one named yet: the header shows the team trio, not an empty avatar.
    expect(document.querySelector<HTMLElement>('.nx-team')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.nx-avatar')!.hidden).toBe(true);
    launcher.click();
    expect(document.querySelector<HTMLElement>('.nx-panel')!.hidden).toBe(true);
  });
});
