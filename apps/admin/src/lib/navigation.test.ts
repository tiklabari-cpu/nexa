/**
 * The menu table (tm 389.6): every entry names a permission the server knows, has words in both
 * languages, and the twelve pages the design promises are all there.
 */
import { PLATFORM_ROLES, platformPermissionsFor } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { hasMessage, LOCALES } from './i18n.js';
import { NAV_ITEMS, isKnownPermission, visibleNavItems } from './navigation.js';

describe('NAV_ITEMS', () => {
  it('lists the twelve pages of the design, in menu order', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      'dashboard',
      'workspaces',
      'accounts',
      'billing',
      'usage',
      'settings',
      'ai',
      'operations',
      'audit',
      'security',
      'admins',
      'support',
    ]);
  });

  it('names only permissions the server knows', () => {
    for (const item of NAV_ITEMS) {
      expect(isKnownPermission(item.permission), `${item.id}: ${item.permission}`).toBe(true);
    }
  });

  it('gives each page a unique path and id, and a path that is the id', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.path)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) expect(item.path).toBe(`/${item.id}`);
  });

  it('has a label and a description in every language', () => {
    for (const item of NAV_ITEMS) {
      for (const locale of LOCALES) {
        expect(hasMessage(locale, item.labelKey), `${locale}:${item.labelKey}`).toBe(true);
        expect(hasMessage(locale, item.descriptionKey), `${locale}:${item.descriptionKey}`).toBe(
          true,
        );
      }
    }
  });
});

describe('visibleNavItems', () => {
  it('shows nothing to an operator with no permissions', () => {
    expect(visibleNavItems([])).toEqual([]);
  });

  it('shows a superadmin everything and a billing operator only what billing can read', () => {
    expect(visibleNavItems(platformPermissionsFor('superadmin'))).toHaveLength(12);

    const billing = visibleNavItems(platformPermissionsFor('billing')).map((item) => item.id);
    expect(billing).toEqual(['dashboard', 'workspaces', 'billing', 'usage']);
  });

  it('never shows a role a page its permissions do not open', () => {
    for (const role of PLATFORM_ROLES) {
      const permissions = platformPermissionsFor(role);
      for (const item of visibleNavItems(permissions)) {
        expect(permissions).toContain(item.permission);
      }
    }
  });
});
