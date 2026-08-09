import { describe, expect, it } from 'vitest';
import { API_PACKAGE_CATALOG, findApiPackage, isApiPackageId } from './api-packages.js';

describe('API package catalogue', () => {
  it('has exactly three packages with unique ids', () => {
    expect(API_PACKAGE_CATALOG.length).toBe(3);
    const ids = API_PACKAGE_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every package has a positive quota and price', () => {
    for (const entry of API_PACKAGE_CATALOG) {
      expect(entry.name).not.toBe('');
      expect(entry.api_calls).toBeGreaterThan(0);
      expect(entry.price_cents).toBeGreaterThan(0);
    }
  });

  // PRD FR-MOD-09.3 gözlem rakamları (satır 666/1412): Essential 100K $29.99, Pro 500K $149.99.
  it('matches the PRD observation numbers for Essential and Pro', () => {
    expect(findApiPackage('essential')).toMatchObject({ api_calls: 100_000, price_cents: 2999 });
    expect(findApiPackage('pro')).toMatchObject({ api_calls: 500_000, price_cents: 14999 });
  });

  it('resolves ids and rejects unknown ones', () => {
    expect(findApiPackage(API_PACKAGE_CATALOG[0]!.id)?.id).toBe(API_PACKAGE_CATALOG[0]!.id);
    expect(findApiPackage('not-a-package')).toBeUndefined();
    expect(isApiPackageId(API_PACKAGE_CATALOG[0]!.id)).toBe(true);
    expect(isApiPackageId('not-a-package')).toBe(false);
    expect(isApiPackageId(42)).toBe(false);
  });
});
