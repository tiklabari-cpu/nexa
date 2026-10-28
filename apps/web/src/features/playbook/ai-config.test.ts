/**
 * The version bar's and the Versions tab's rules (tm 316.4 · AI-20): why
 * "Onaya gönder" is closed, why "Approve" is, which versions a rollback can
 * copy, and the `If-Match` a submission carries.
 */
import { describe, expect, it } from 'vitest';
import {
  approveBlock,
  canRollBackTo,
  ifMatch,
  publishAtFromInput,
  submitBlock,
  type AiConfigDraft,
} from './ai-config.js';

function draft(extra: Partial<AiConfigDraft> = {}): AiConfigDraft {
  return {
    ai_agent_id: 'b1',
    draft_revision: 4,
    active: true,
    published: null,
    open: null,
    ok: true,
    problems: [],
    warnings: [],
    diff: {
      base_version_id: null,
      from_baseline: false,
      changes: 2,
      sections: [],
      touches_compliance: false,
      compliance: [],
    },
    compliance_gate: { state: 'passed', open: true, run_id: 'r1' },
    submittable: true,
    ...extra,
  };
}

describe('submitBlock (AI-20 · tm 316.4)', () => {
  it('is open when the server says the draft is submittable', () => {
    expect(submitBlock(draft())).toBeNull();
  });

  it('names the problems first, then an empty draft, then the compliance gate', () => {
    expect(
      submitBlock(
        draft({
          submittable: false,
          ok: false,
          diff: null,
          problems: [{ code: 'skill_steps_invalid', section: 'skills', key: 's1', message: 'x' }],
          compliance_gate: { state: 'missing', open: false, run_id: null },
        }),
      ),
    ).toEqual({ kind: 'problems', count: 1 });
    expect(
      submitBlock(
        draft({
          submittable: false,
          diff: { ...draft().diff!, changes: 0 },
          compliance_gate: { state: 'missing', open: false, run_id: null },
        }),
      ),
    ).toEqual({ kind: 'no_changes' });
    expect(
      submitBlock(
        draft({
          submittable: false,
          compliance_gate: { state: 'failed', open: false, run_id: 'r' },
        }),
      ),
    ).toEqual({ kind: 'compliance', state: 'failed' });
  });
});

describe('approveBlock (AI-20 · tm 316.4)', () => {
  const admin = { accountId: 'a-admin', role: 'admin' };

  it('closes approval of one’s own submission, whatever the role', () => {
    expect(approveBlock({ submitted_by: 'a-admin', touches_compliance: false }, admin)).toBe(
      'own_submission',
    );
    expect(
      approveBlock(
        { submitted_by: 'a-owner', touches_compliance: false },
        { accountId: 'a-owner', role: 'owner' },
      ),
    ).toBe('own_submission');
  });

  it('leaves a compliance change to the Founder', () => {
    expect(approveBlock({ submitted_by: 'a-lead', touches_compliance: true }, admin)).toBe(
      'owner_required',
    );
    expect(
      approveBlock(
        { submitted_by: 'a-lead', touches_compliance: true },
        { accountId: 'a-owner', role: 'owner' },
      ),
    ).toBeNull();
  });

  it('lets an administrator approve somebody else’s ordinary version', () => {
    expect(approveBlock({ submitted_by: 'a-lead', touches_compliance: false }, admin)).toBeNull();
  });
});

describe('canRollBackTo (AI-20 · tm 316.4)', () => {
  it('copies only a replaced version that holds a package', () => {
    const at = '2026-10-28T10:00:00.000Z';
    expect(canRollBackTo({ status: 'superseded', package_format: 1, published_at: at })).toBe(true);
    expect(canRollBackTo({ status: 'published', package_format: 1, published_at: at })).toBe(false);
    expect(canRollBackTo({ status: 'superseded', package_format: 0, published_at: at })).toBe(
      false,
    );
    expect(canRollBackTo({ status: 'rejected', package_format: 1, published_at: null })).toBe(
      false,
    );
  });
});

describe('request helpers (AI-20 · tm 316.4)', () => {
  it('sends the draft revision quoted, as the ETag gave it', () => {
    expect(ifMatch(12)).toEqual({ headers: { 'If-Match': '"12"' } });
  });

  it('reads the datetime field as an instant, empty as now', () => {
    expect(publishAtFromInput('')).toBeNull();
    expect(publishAtFromInput('not a date')).toBeNull();
    expect(publishAtFromInput('2026-11-01T09:30')).toBe(new Date('2026-11-01T09:30').toISOString());
  });
});
