/**
 * Every action the server can write has a label in both languages (tm 259.16).
 *
 * The vocabulary is a closed list in the API (`AUDIT_ACTIONS`); the web app has
 * no shared package to import it from, so this test reads the API source and
 * pulls the list out of the array literal. Adding an action there without
 * `audit.action.<code>` in `locales/en/audit-labels.ts` and its `tr` twin fails
 * here. To update after a deliberate API change: add the two labels — nothing in
 * this file is a list to maintain by hand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '../../lib/i18n.js';

function serverActions(): string[] {
  const source = readFileSync(
    join(process.cwd(), '..', 'api', 'src', 'services', 'audit', 'audit-log.ts'),
    'utf8',
  );
  const body = /export const AUDIT_ACTIONS = \[([\s\S]*?)\] as const/.exec(source)?.[1];
  if (body === undefined) throw new Error('AUDIT_ACTIONS array not found in audit-log.ts');
  const code = body.replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]!);
}

describe('audit action labels', () => {
  const actions = serverActions();

  it('found the server vocabulary', () => {
    expect(actions.length).toBeGreaterThan(80);
    expect(actions).toContain('auth.login');
  });

  it.each(['en', 'tr'] as const)('has a %s label for every server action', (locale) => {
    const missing = actions.filter((code) => !hasMessage(locale, `audit.action.${code}`));
    expect(missing).toEqual([]);
  });

  it('never labels an action with its own code', () => {
    for (const code of actions) {
      expect(translate('en', `audit.action.${code}`)).not.toBe(code);
      expect(translate('tr', `audit.action.${code}`)).not.toBe(code);
    }
  });
});
