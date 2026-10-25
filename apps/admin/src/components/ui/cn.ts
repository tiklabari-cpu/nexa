/**
 * The one class-name joiner the design system uses.
 *
 * Components compose Tailwind utility strings by hand across this codebase;
 * this keeps that honest — falsy entries drop out so a conditional class does
 * not leave a stray `undefined` in the attribute — without pulling in a
 * dependency for what is three lines.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
