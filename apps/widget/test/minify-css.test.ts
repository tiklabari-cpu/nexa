/**
 * The build's stylesheet minifier (tm 320.1 · NFR-P3): the widget's real
 * `WIDGET_CSS`, parsed before and after, is the same rules in the same order —
 * only the comments and the spaces no parser needs are gone — and the lines
 * stay where they were, so the build's source map stays true.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { minifyCss, widgetCssOf } from '../minify-css';

const source = readFileSync(resolve(import.meta.dirname, '../src/widget.ts'), 'utf8');

/**
 * Every rule's text as the parser serialises it. jsdom keeps a value's own
 * spacing (`rgba(0, 0, 0)` and `rgba(0,0,0)` print apart though they are the
 * same colour), so the space beside a comma and a line break are evened out —
 * a lost, merged or reordered rule, selector or declaration still shows.
 */
function rulesOf(css: string): string[] {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const rules = [...(style.sheet?.cssRules ?? [])].map((rule) =>
    rule.cssText.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' '),
  );
  style.remove();
  return rules;
}

describe('the widget stylesheet minifier', () => {
  const css = widgetCssOf(source);

  it('finds the stylesheet in src/widget.ts', () => {
    expect(css).not.toBeNull();
    expect(css!.length).toBeGreaterThan(10_000);
  });

  it('leaves every rule as it was, in the same order', () => {
    const before = rulesOf(css!);
    const after = rulesOf(minifyCss(css!));
    expect(before.length).toBeGreaterThan(100);
    expect(after).toEqual(before);
  });

  it('keeps the line count, and drops the comments and indentation', () => {
    const minified = minifyCss(css!);
    expect(minified.split('\n')).toHaveLength(css!.split('\n').length);
    expect(minified).not.toContain('/*');
    expect(minified).not.toMatch(/\n[ \t]/);
    expect(minified.length).toBeLessThan(css!.length * 0.8);
  });

  it('drops the space after a declaration colon and the last semicolon, but not a selector colon or a string', () => {
    expect(minifyCss('a:hover { color: red; margin: 0; }')).toBe('a:hover{color:red;margin:0}');
    expect(minifyCss('.x::after { content: "a: b"; }')).toBe('.x::after{content:"a: b"}');
  });

  it('keeps the spaces a parser needs: combinators and calc() arithmetic', () => {
    expect(minifyCss('.a :focus { width: calc(100% - 2px); }')).toBe(
      '.a :focus{width:calc(100% - 2px)}',
    );
    expect(minifyCss('.a + .b ~ .c > .d { margin: 0 auto; }')).toBe(
      '.a + .b ~ .c > .d{margin:0 auto}',
    );
  });
});
