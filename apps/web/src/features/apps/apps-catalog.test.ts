/**
 * The marketplace card descriptions the panel translates (tm 413). The API ships English; every
 * catalogue id needs an en and a tr line, and the English line must be the API's own text so an
 * English agent reads exactly what the server sends.
 */
import { describe, expect, it } from 'vitest';
import { APP_CATALOG } from '@siyahtus/types';
import { hasMessage, translate } from '../../lib/i18n.js';

describe('app catalogue descriptions', () => {
  it('has an English and a Turkish line for every catalogue app', () => {
    for (const app of APP_CATALOG) {
      const key = `apps.catalog.${app.id}`;
      expect(hasMessage('en', key), `en ${key}`).toBe(true);
      expect(hasMessage('tr', key), `tr ${key}`).toBe(true);
    }
  });

  it('keeps the English line identical to the API text', () => {
    for (const app of APP_CATALOG) {
      expect(translate('en', `apps.catalog.${app.id}`), app.id).toBe(app.description);
    }
  });

  it('never leaves a Turkish line identical to the English one', () => {
    for (const app of APP_CATALOG) {
      const key = `apps.catalog.${app.id}`;
      expect(translate('tr', key), app.id).not.toBe(translate('en', key));
    }
  });
});
