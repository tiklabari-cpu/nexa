/**
 * Clearing what a skill run's log says about the player (tm 424 · NFR-C8).
 *
 * A `skill_runs` row is two things at once. Its counts — that a procedure or a
 * Copilot assist ran, how it ended, what the models it called cost — are the
 * workspace's own usage history: the AI Agent report counts the rows and sums
 * their tokens, and the Reports "assisted" split keys off a Copilot run's
 * existence. Its `log` entries are prose that may quote the player
 * (`ai-responder.ts` masks card numbers and the like, not sentences), and a
 * Copilot summary's entry is the conversation in brief.
 *
 * The foreign keys keep the first and so, until tm 424, kept the second: chat
 * and thread are both `ON DELETE SET NULL`, so a retention sweep that took the
 * conversation, or an erasure that took the person, left the run standing with
 * the player's words in it and nothing pointing at it. Deleting the rows would
 * rewrite the usage figures of periods already reported (and billed against,
 * for the tokens); changing the foreign keys to `CASCADE` would do the same.
 * So the rows stay and the text goes, explicitly, at the three moments the
 * conversation does:
 *
 *   - **the retention sweep's thread delete** clears the runs on each thread
 *     it removes, in the same statement (`retention.ts`);
 *   - **a run with no thread** — a Copilot assist (it records the chat only),
 *     a preview, a run from before `thread_id` was kept, or one whose thread an
 *     earlier sweep already took — is cleared by age under the same thread
 *     window, the way an AI decision record with no connection is deleted;
 *   - **a customer erasure** clears the runs on the subject's chats before it
 *     deletes them (`erasure.ts`) — afterwards `chat_id` is null and nothing
 *     would find them.
 *
 * "Cleared" is {@link CLEARED_SKILL_RUN_LOG}: the entries emptied and the
 * outcome kept, because the outcome is a closed vocabulary (`answered`,
 * `handed_off`, `skipped`, `copilot_<action>`) — a fact about the procedure,
 * not about the person — and the Playbook's run list shows it.
 */
import { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';

/**
 * The value a cleared `log` holds, as an expression over the row's own `log`.
 *
 * A run written since tm 255 is an envelope, `{ outcome, entries }`: it keeps
 * its outcome when that is a string and loses its entries. Anything else — a
 * plain array from before the envelope, an envelope without a string outcome —
 * becomes `[]`, the column's default. Every clearing statement also filters on
 * `log <> CLEARED_SKILL_RUN_LOG`, so a cleared row is never written twice and a
 * batch loop counts only real changes.
 */
export const CLEARED_SKILL_RUN_LOG = Prisma.sql`(CASE
    WHEN jsonb_typeof(log) = 'object' AND jsonb_typeof(log -> 'outcome') = 'string'
      THEN jsonb_build_object('outcome', log -> 'outcome', 'entries', '[]'::jsonb)
    ELSE '[]'::jsonb
  END)`;

/**
 * Clear the logs of every run on `chatIds` (a customer erasure, before the
 * chats go). Returns how many runs had text to clear. RLS confines it to the
 * caller's workspace; `skill_runs_chat_id_idx` keeps it a lookup.
 */
export function clearSkillRunLogsOfChats(
  tx: TenantClient,
  chatIds: readonly string[],
): Promise<number> {
  if (chatIds.length === 0) return Promise.resolve(0);
  return tx.$executeRaw`
    UPDATE skill_runs SET log = ${CLEARED_SKILL_RUN_LOG}
     WHERE chat_id = ANY(${[...chatIds]}::text[])
       AND log <> ${CLEARED_SKILL_RUN_LOG}`;
}

/**
 * Clear up to `limit` runs with no thread that ran before `cutoff`, oldest
 * first — the retention sweep's by-age step, batched like its deletes.
 */
export function clearThreadlessSkillRunLogBatch(
  tx: TenantClient,
  cutoff: Date,
  limit: number,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE skill_runs SET log = ${CLEARED_SKILL_RUN_LOG}
     WHERE id IN (
       SELECT id FROM skill_runs
        WHERE thread_id IS NULL
          AND ran_at < ${cutoff}
          AND log <> ${CLEARED_SKILL_RUN_LOG}
        ORDER BY ran_at
        LIMIT ${limit}
     )`;
}

/** {@link clearThreadlessSkillRunLogBatch}'s dry-run: how many it would clear. */
export async function countThreadlessSkillRunLogs(tx: TenantClient, cutoff: Date): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM skill_runs
     WHERE thread_id IS NULL
       AND ran_at < ${cutoff}
       AND log <> ${CLEARED_SKILL_RUN_LOG}`;
  return Number(rows[0]?.n ?? 0n);
}
