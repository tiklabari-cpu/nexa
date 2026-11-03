import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PANEL_SANDBOX,
  CUSTOM_PANEL_URL_MAX,
  customPanelAudience,
  customPanelOrigin,
  customPanelUrlProblem,
} from './custom-panels.js';

describe('custom panel addresses (KN-05 · K29)', () => {
  it('takes an https address with a path and a query', () => {
    expect(customPanelUrlProblem('https://backoffice.example/player?view=card')).toBeNull();
    expect(customPanelUrlProblem('https://bo.example:8443/')).toBeNull();
  });

  it('refuses anything but https — K29 opens no http:', () => {
    expect(customPanelUrlProblem('http://backoffice.example/')).toBe('not_https');
    expect(customPanelUrlProblem('javascript:alert(1)')).toBe('not_https');
    expect(customPanelUrlProblem('data:text/html,<p>x</p>')).toBe('not_https');
  });

  it('refuses credentials, a fragment, whitespace, junk and an over-long address', () => {
    expect(customPanelUrlProblem('https://user:pw@bo.example/')).toBe('credentials');
    expect(customPanelUrlProblem('https://bo.example/#player')).toBe('fragment');
    expect(customPanelUrlProblem('https://bo.example/a b')).toBe('invalid');
    expect(customPanelUrlProblem('backoffice')).toBe('invalid');
    expect(customPanelUrlProblem(`https://bo.example/${'a'.repeat(CUSTOM_PANEL_URL_MAX)}`)).toBe(
      'too_long',
    );
  });

  it('reads the origin and names one panel per audience', () => {
    expect(customPanelOrigin('https://bo.example:8443/p?q=1')).toBe('https://bo.example:8443');
    expect(customPanelAudience('p-1')).toBe('siyahtus-panel:p-1');
  });

  it('frames without allow-same-origin or top navigation', () => {
    expect(CUSTOM_PANEL_SANDBOX.split(' ').sort()).toEqual([
      'allow-forms',
      'allow-popups',
      'allow-scripts',
    ]);
  });
});
