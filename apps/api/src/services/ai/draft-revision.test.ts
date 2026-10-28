import { describe, expect, it } from 'vitest';
import { changesDraft, draftReachOf, EVERY_DRAFT } from './draft-revision.js';

const AGENT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('which saves move the draft revision, and whose (tm 316.2 · ADR-14b §2.5)', () => {
  it('a meta field or the pause switch alone does not move it; anything else does', () => {
    expect(changesDraft('skills', [{ path: 'owner_id', kind: 'changed' }])).toBe(false);
    expect(changesDraft('ai_agents', [{ path: 'active', kind: 'changed' }])).toBe(false);
    expect(
      changesDraft('ai_agents', [
        { path: 'active', kind: 'changed' },
        { path: 'tone', kind: 'changed' },
      ]),
    ).toBe(true);
    expect(changesDraft('skills', [{ path: 'active', kind: 'changed' }])).toBe(true);
    expect(changesDraft('skills', [{ path: 'steps[0].text', kind: 'changed' }])).toBe(true);
    // A reindex: no field moved, the text was embedded again.
    expect(changesDraft('knowledge_sources', [])).toBe(true);
  });

  it("reaches the row's own agent, before or after the write", () => {
    expect(draftReachOf('skills', [{ ai_agent_id: AGENT }, null])).toEqual({
      all: false,
      ids: [AGENT],
    });
    expect(draftReachOf('ai_agents', [null, { id: AGENT }])).toEqual({ all: false, ids: [AGENT] });
  });

  it('reaches every agent for the workspace-wide tables', () => {
    for (const table of ['kb_bonuses', 'handoff_routes', 'ai_access_info'] as const) {
      expect(draftReachOf(table, [{ id: 'x' }, null])).toBe(EVERY_DRAFT);
    }
  });

  it('reaches a knowledge source’s agents only when customer-facing agents read it', () => {
    expect(
      draftReachOf('knowledge_sources', [{ audiences: ['copilot'], ai_agent_ids: [] }]),
    ).toEqual({ all: false, ids: [] });
    expect(
      draftReachOf('knowledge_sources', [{ audiences: ['ai_agent', 'copilot'], ai_agent_ids: [] }]),
    ).toBe(EVERY_DRAFT);
    expect(
      draftReachOf('knowledge_sources', [
        { audiences: ['ai_agent'], ai_agent_ids: [AGENT] },
        { audiences: ['ai_agent'], ai_agent_ids: [OTHER] },
      ]),
    ).toEqual({ all: false, ids: [AGENT, OTHER] });
    // Taken away from the AI: the agents that read it before still move.
    expect(
      draftReachOf('knowledge_sources', [
        { audiences: ['ai_agent'], ai_agent_ids: [AGENT] },
        { audiences: ['copilot'], ai_agent_ids: [] },
      ]),
    ).toEqual({ all: false, ids: [AGENT] });
  });
});
