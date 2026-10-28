import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_PACKAGE_FORMAT,
  AI_CONFIG_PACKAGE_FORMAT_BASELINE,
  type AiConfigKnowledgeManifestEntry,
} from '@siyahtus/types';
import type { StoredAiConfig } from './config-compiler.js';
import { rebaseManifest } from './config-versions.js';

const A = '0a000000-0000-4000-8000-000000000000';
const B = '0b000000-0000-4000-8000-000000000000';
const C = '0c000000-0000-4000-8000-000000000000';

function entry(sourceId: string, generation = 1): AiConfigKnowledgeManifestEntry {
  return {
    source_id: sourceId,
    generation,
    chunk_count: 2,
    type: 'article',
    audiences: ['ai_agent'],
    ai_agent_ids: [],
    brand_ids: [],
    language: null,
    valid_until: null,
  };
}

function pkg(tone: string) {
  return {
    package_format: AI_CONFIG_PACKAGE_FORMAT,
    agent: { id: 'agent', persona: { tone }, style: {} },
    turn: { skills: [] },
  };
}

function stored(
  id: string,
  tone: string,
  manifest: AiConfigKnowledgeManifestEntry[],
): StoredAiConfig {
  return {
    versionId: id,
    packageFormat: AI_CONFIG_PACKAGE_FORMAT,
    snapshot: pkg(tone),
    knowledgeManifest: manifest,
  };
}

describe('a version whose base was published over (tm 316.2 · ADR-14b §2.10 (4))', () => {
  const base = stored('v1', 'friendly', [entry(A), entry(B)]);

  it('follows the published version where only knowledge it did not touch moved', () => {
    // Published since: A's text was refreshed (generation 2). The open version changed B.
    const current = stored('v2', 'friendly', [entry(A, 2), entry(B)]);
    const next = stored('v3', 'friendly', [entry(A), entry(B, 3)]);
    expect(rebaseManifest(base, current, next)).toEqual([entry(A, 2), entry(B, 3)]);
  });

  it('takes a source the other publication added or removed with it', () => {
    const current = stored('v2', 'friendly', [entry(B), entry(C)]);
    const next = stored('v3', 'friendly', [entry(A), entry(B, 4)]);
    expect(rebaseManifest(base, current, next)).toEqual([entry(B, 4), entry(C)]);
  });

  it('is stale when both changed the same source', () => {
    const current = stored('v2', 'friendly', [entry(A, 2), entry(B)]);
    const next = stored('v3', 'friendly', [entry(A, 3), entry(B)]);
    expect(rebaseManifest(base, current, next)).toBeNull();
  });

  it('is stale when anything but knowledge was published over the base', () => {
    const current = stored('v2', 'formal', [entry(A), entry(B)]);
    const next = stored('v3', 'friendly', [entry(A), entry(B, 2)]);
    expect(rebaseManifest(base, current, next)).toBeNull();
  });

  it('is stale against the uncompiled first version, and with nothing published', () => {
    const baseline: StoredAiConfig = {
      versionId: 'v1',
      packageFormat: AI_CONFIG_PACKAGE_FORMAT_BASELINE,
      snapshot: {},
      knowledgeManifest: [],
    };
    const current = stored('v2', 'friendly', [entry(A)]);
    const next = stored('v3', 'friendly', [entry(A)]);
    expect(rebaseManifest(baseline, current, next)).toBeNull();
    expect(rebaseManifest(base, null, next)).toBeNull();
  });
});
