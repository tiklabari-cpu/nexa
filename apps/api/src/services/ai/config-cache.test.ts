import { describe, expect, it } from 'vitest';
import { AiConfigPackageCache, type CachedAiConfig } from './config-cache.js';

function entry(versionId: string, bytes = 10): CachedAiConfig {
  return {
    versionId,
    aiAgentId: 'agent',
    number: 1,
    minor: 0,
    seq: 1,
    turn: { skills: [{ id: 's', name: 'S', aiAgentId: 'agent', steps: [{ type: 'x' }] }] },
    sources: [],
    bytes,
  } as unknown as CachedAiConfig;
}

describe('AiConfigPackageCache (tm 316.3 · ADR-14b §2.6)', () => {
  it('keeps a package by version id and serves it again', () => {
    const cache = new AiConfigPackageCache(4, 1_000);
    cache.set(entry('a'));
    expect(cache.get('a')?.versionId).toBe('a');
    expect(cache.get('b')).toBeUndefined();
  });

  it('drops the least recently used package past its entry bound', () => {
    const cache = new AiConfigPackageCache(2, 1_000);
    cache.set(entry('a'));
    cache.set(entry('b'));
    cache.get('a');
    cache.set(entry('c'));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it('drops the oldest packages past its byte bound, and never keeps one larger than the bound', () => {
    const cache = new AiConfigPackageCache(10, 100);
    cache.set(entry('a', 40));
    cache.set(entry('b', 40));
    cache.set(entry('c', 40));
    expect(cache.get('a')).toBeUndefined();
    expect(cache.bytes).toBe(80);
    const huge = cache.set(entry('d', 101));
    expect(huge.versionId).toBe('d');
    expect(cache.get('d')).toBeUndefined();
    expect(cache.bytes).toBe(80);
  });

  it('counts a package set twice once', () => {
    const cache = new AiConfigPackageCache(10, 100);
    cache.set(entry('a', 30));
    cache.set(entry('a', 30));
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(30);
  });

  it('freezes what it keeps: a turn cannot change the package the next turn reads', () => {
    const cache = new AiConfigPackageCache();
    const kept = cache.set(entry('a'));
    const skill = kept.turn.skills[0] as unknown as { steps: Array<{ type: string }> };
    expect(Object.isFrozen(kept.turn)).toBe(true);
    expect(() => {
      skill.steps[0]!.type = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (kept.turn.skills as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });
});
