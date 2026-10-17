/**
 * "Önce AI" — the AI answers before anyone is assigned (tm 293.2 · SiyahTuş
 * analysis AI-11 §3, §7; owner decision K9).
 *
 * Until now routing assigned a visitor's connection the moment it opened, so
 * the AI and an agent answered the same player side by side, and every
 * conversation the AI was handling sat in an agent's concurrent-chat count.
 * An AI agent set to `ai_first` (`ai_handoff_settings.assignment_mode`) opens
 * the connection instead:
 *
 *   - unassigned and outside the queue (`queue_position` null), so no agent's
 *     limit is spent and the drain never hands it out;
 *   - in `ai` mode (`threads.ai_mode`), which is what files it under the AI
 *     view rather than "unassigned" or "queued";
 *   - still in its team — the team the routing rules pick, its access row
 *     written as on any open — so the agents who would have had it can see it.
 *
 * A person is routed to it when it leaves the AI (`chat-service.ts`
 * `#routeHandover`): the writer when an agent writes to the player, the
 * supervisor on a takeover, and the routing engine — today's `route()`, until
 * AI-12's hand-over targets — when the AI or a rule bot hands it on.
 *
 * `parallel` is the behaviour before this, and the default
 * (`DEFAULT_AI_ASSIGNMENT_MODE`): no settings row changes nothing.
 *
 * Beside the chat core, which is its only caller, and reading tables rather
 * than the AI's configuration seam: the question is asked when a connection
 * opens, before there is a conversation to pin a configuration to, and it is a
 * question about when a person is routed, which ADR-14b §2.2 keeps live.
 */
import { DEFAULT_AI_ASSIGNMENT_MODE } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/**
 * Whether a visitor's connection opening now opens AI-first: some AI agent
 * would answer it, and every agent that would is set to `ai_first`.
 *
 * "Would answer" is the live turn's own reading (`turn-config.ts`
 * `liveTurnConfig`): an active customer-facing agent with at least one active
 * skill. An agent with nothing to run answers nobody, so it cannot hold a
 * conversation back from a person; one agent that still assigns on open
 * (`parallel`, or no row) keeps the open as it was — a person is routed, the
 * safe side of a split decision. v1 has one customer-facing agent per
 * workspace (tm 390), where neither case arises.
 *
 * Tenant-scoped by RLS on all three tables.
 */
export async function opensAiFirst(tx: TenantClient): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ answering: number; ai_first: number }>>`
    SELECT count(*)::int AS answering,
           count(*) FILTER (
             WHERE COALESCE(h.assignment_mode, ${DEFAULT_AI_ASSIGNMENT_MODE}) = 'ai_first'
           )::int AS ai_first
      FROM ai_agents a
      LEFT JOIN ai_handoff_settings h ON h.ai_agent_id = a.id
     WHERE a.active
       AND a.kind = 'ai_agent'
       AND EXISTS (
         SELECT 1 FROM skills s
          WHERE s.ai_agent_id = a.id AND s.active AND s.kind = 'ai_agent'
       )`;
  const row = rows[0];
  return row !== undefined && row.answering > 0 && row.ai_first === row.answering;
}
