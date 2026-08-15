import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS, entitlementMap, isEntitlement } from './entitlements.js';

describe('entitlement vocabulary', () => {
  it('names the six capabilities the PRD reserves for Enterprise, uniquely', () => {
    // white_label/sandbox/sla come from FR-MOD-11.5 + PRD §5.4; sso/hipaa/
    // siem_export from NFR-S11/C4/S12, each of which says "Enterprise" in as
    // many words. A key dropped here is a capability nothing can gate.
    expect([...ENTITLEMENTS].sort()).toEqual(
      ['hipaa', 'sandbox', 'siem_export', 'sla', 'sso', 'white_label'].sort(),
    );
    expect(new Set(ENTITLEMENTS).size).toBe(ENTITLEMENTS.length);
  });

  it('recognises its own keys and nothing else', () => {
    for (const key of ENTITLEMENTS) expect(isEntitlement(key)).toBe(true);
    expect(isEntitlement('white-label')).toBe(false);
    expect(isEntitlement('')).toBe(false);
    expect(isEntitlement(null)).toBe(false);
    expect(isEntitlement(42)).toBe(false);
  });
});

describe('entitlementMap', () => {
  it('answers every key, so an absent one can never read as granted', () => {
    const map = entitlementMap(['white_label']);
    expect(Object.keys(map).sort()).toEqual([...ENTITLEMENTS].sort());
    for (const key of ENTITLEMENTS) expect(typeof map[key]).toBe('boolean');
  });

  it('grants what is listed and denies the rest', () => {
    const map = entitlementMap(['white_label', 'sla']);
    expect(map.white_label).toBe(true);
    expect(map.sla).toBe(true);
    expect(map.sandbox).toBe(false);
    expect(map.sso).toBe(false);
    expect(map.hipaa).toBe(false);
    expect(map.siem_export).toBe(false);
  });

  it('denies everything for an empty grant list', () => {
    expect(Object.values(entitlementMap([]))).toEqual(ENTITLEMENTS.map(() => false));
  });

  it('grants everything when every key is listed', () => {
    expect(Object.values(entitlementMap([...ENTITLEMENTS]))).toEqual(ENTITLEMENTS.map(() => true));
  });

  it('hands back a fresh map each call — one caller cannot poison another', () => {
    const first = entitlementMap([]);
    first.white_label = true;
    expect(entitlementMap([]).white_label).toBe(false);
  });
});
