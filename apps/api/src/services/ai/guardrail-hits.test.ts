/**
 * The guardrails' hit rows (tm 301.3 · AI-08 §8): one per hit, under the
 * turn, the evidence masked (AI-26) and cut — and a write that fails is one
 * error line, never a thrown error.
 */
import { describe, expect, it } from 'vitest';
import { GUARDRAIL_QUOTE_MAX, PLATFORM_GUARDRAILS_VERSION } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { guardrailHit } from './conversation/guardrails/record.js';
import type { TenantRunner } from './conversation/turn.js';
import { recordGuardrailHits } from './guardrail-hits.js';

const TENANT: TenantContext = { licenseId: 7n, organizationId: 'org-test' };
const TURN = '66666666-6666-4666-8666-666666666666';

function capturing() {
  const written: unknown[] = [];
  const db: TenantRunner = (fn) =>
    fn({
      aiGuardrailHit: {
        createMany: async ({ data }: { data: unknown[] }) => {
          written.push(...data);
          return { count: data.length };
        },
      },
    } as unknown as TenantClient);
  return { db, written };
}

const errors: Array<Record<string, unknown>> = [];
const log = { error: (object: Record<string, unknown>) => void errors.push(object) };

describe('the hit rows (AI-08 §8)', () => {
  it('one row per hit under the turn, with the version — the evidence masked by its author’s policy', async () => {
    const { db, written } = capturing();
    const count = await recordGuardrailHits(
      db,
      TENANT,
      {
        chatId: 'chat-1',
        threadId: 'thread-1',
        turnId: TURN,
        record: {
          catalog_version: PLATFORM_GUARDRAILS_VERSION,
          hits: [
            guardrailHit(
              { source: 'platform', id: 'G13' },
              'input',
              'evidence',
              'kartım 4111 1111 1111 1111 çalındı',
              2,
            ),
            guardrailHit({ source: 'phrase', id: 'p-1' }, 'output', 'rewrite', 'x'.repeat(250)),
            guardrailHit({ source: 'platform', id: 'G4' }, 'input', 'prompt_block'),
          ],
          risk_flags: [],
        },
      },
      log,
    );
    expect(count).toBe(3);
    expect(written).toEqual([
      {
        licenseId: 7n,
        chatId: 'chat-1',
        threadId: 'thread-1',
        turnId: TURN,
        ruleKey: 'G13',
        stage: 'input',
        actionTaken: 'evidence',
        evidence: 'kartım **** **** **** 1111 çalındı',
        patternIndex: 2,
        catalogVersion: PLATFORM_GUARDRAILS_VERSION,
      },
      expect.objectContaining({ ruleKey: 'phrase:p-1', evidence: 'x'.repeat(GUARDRAIL_QUOTE_MAX) }),
      expect.objectContaining({ ruleKey: 'G4', actionTaken: 'prompt_block', evidence: null }),
    ]);
  });

  it('nothing to write is no write; a write that fails is a log line and 0', async () => {
    const { db, written } = capturing();
    const empty = { catalog_version: PLATFORM_GUARDRAILS_VERSION, hits: [], risk_flags: [] };
    expect(
      await recordGuardrailHits(
        db,
        TENANT,
        { chatId: 'c', threadId: 't', turnId: TURN, record: empty },
        log,
      ),
    ).toBe(0);
    expect(written).toEqual([]);

    const failing: TenantRunner = () => Promise.reject(new Error('database away'));
    const count = await recordGuardrailHits(
      failing,
      TENANT,
      {
        chatId: 'c',
        threadId: 't',
        turnId: TURN,
        record: {
          ...empty,
          hits: [
            guardrailHit({ source: 'platform', id: 'G1' }, 'input', 'handoff', 'hesabımı kapatın'),
          ],
        },
      },
      log,
    );
    expect(count).toBe(0);
    expect(errors).toEqual([expect.objectContaining({ hits: 1 })]);
  });
});
