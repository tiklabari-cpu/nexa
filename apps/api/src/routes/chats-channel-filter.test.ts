/**
 * The `channel` filter on `GET /chats` (FR-MOD-02.1.4), pinned where no
 * compiler is looking (tm 218).
 *
 * Two of the three places the adapter-channel list appears are type-checked:
 * `routes/chats.ts` builds its validator from `ADAPTER_CHANNEL_TYPES` and
 * `features/inbox/views.ts` types its rows from it, so a value added or dropped
 * there moves both at once. The third — the OpenAPI enum in
 * `openapi/paths/chats.yaml` — is a string in a YAML file, and it is the one a
 * client reads to know what it may send. A channel the rail can render and the
 * contract does not name is a row that answers 400 on click; a channel the
 * contract names and the server does not accept is the same defect one layer
 * down. So the enum is compared to the constant here rather than trusted.
 *
 * The second assertion is the invariant the whole design rests on and the one a
 * later change is most likely to break by accident: `channel` and `view` are
 * *orthogonal* axes. Folding a channel into the `view` enum would look like a
 * tidy simplification — one parameter instead of two — and would quietly make
 * "my WhatsApp conversations" unaskable, because every counter, saved view and
 * rail label in the console is keyed on `view`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADAPTER_CHANNEL_TYPES } from '@nexa/types';

// src/routes → apps/api → apps → repo root (the resolution `chart-storage.test.ts` uses).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CHATS_PATHS = 'packages/contract/openapi/paths/chats.yaml';

const contract = readFileSync(resolve(REPO_ROOT, CHATS_PATHS), 'utf8');

/**
 * The inline `enum: [a, b, c]` belonging to the named query parameter of
 * `listChats`.
 *
 * Deliberately anchored on `- name: <param>` and stopped at the next parameter,
 * so it reads *that* parameter's enum rather than whichever one happens to come
 * first in the file. A miss throws instead of returning an empty list — a
 * silently empty expectation would make this file pass while measuring nothing,
 * which is the failure mode a contract sentinel exists to avoid.
 */
function enumOfListChatsParam(param: string): string[] {
  const list = contract.slice(contract.indexOf('  get:'), contract.indexOf('  post:'));
  const start = list.indexOf(`- name: ${param}\n`);
  if (start < 0) throw new Error(`listChats has no \`${param}\` query parameter`);
  const next = list.indexOf('      - ', start + 1);
  const block = next < 0 ? list.slice(start) : list.slice(start, next);
  const match = /enum:\s*\[([^\]]+)\]/.exec(block);
  if (!match) throw new Error(`\`${param}\` carries no inline enum`);
  return (match[1] as string).split(',').map((value) => value.trim());
}

describe('GET /chats `channel` (FR-MOD-02.1.4)', () => {
  it('offers exactly the adapter channels the code knows', () => {
    expect(enumOfListChatsParam('channel')).toEqual([...ADAPTER_CHANNEL_TYPES]);
  });

  it('keeps the channel axis out of `view`', () => {
    const views = enumOfListChatsParam('view');
    for (const channel of ADAPTER_CHANNEL_TYPES) {
      expect(views).not.toContain(channel);
    }
    // And the axis it *is* — eight buckets, unchanged by this filter.
    expect(views).toEqual([
      'all',
      'my',
      'queued',
      'unassigned',
      'supervised',
      'archived',
      'ai',
      'ai_solved',
    ]);
  });
});
