/**
 * The command palette's action catalogue — FR-MOD-01.1.3 (v2 payı).
 *
 * `navigation.ts` has one static list for "where can I jump to"; this is its
 * twin for "what can I do from here without leaving the keyboard". Each entry
 * knows its own display label, search keywords, the scope its target endpoint
 * requires, and how to actually perform it — the palette itself stays a dumb
 * renderer over whichever catalogue produced a given result.
 *
 * This turn wires exactly one action, the PRD's own example: toggling whether
 * the caller is accepting chats. The catalogue was built first (01.1.3-ai-a),
 * then gated on scopes (01.1.3-ai-b), and only now is `run()` reachable from
 * the palette (01.1.3-ai-c) — that order matters, because wiring a trigger
 * before the gate existed would have let an unauthorized agent fire an action
 * the palette had no business offering them.
 *
 * An entry owns its whole optimistic story: it knows what its result looks like
 * locally, so it shows that immediately, and it knows how to take it back if the
 * server refuses. The palette closes the moment a run starts and only hears
 * about failures, which keeps it a launcher rather than a progress dialog.
 */
import type { CurrentAgent } from '../lib/auth-store.js';

/**
 * What an action needs to compute its label and to run — supplied by whatever
 * later wires the palette up to the auth store, not read globally here, so
 * this module stays testable without a store or a DOM.
 */
export interface ActionDeps {
  /** Live snapshot the action reads its current state from. */
  agent: Pick<CurrentAgent, 'routing_status'> | null;
  /**
   * Writes the local snapshot and nothing else — no request. This is both halves
   * of the optimistic dance: the guess an action shows before the server has
   * answered, and the undo it applies when the server refuses.
   */
  applyRoutingStatus: (status: CurrentAgent['routing_status']) => void;
  /** Performs the underlying request; `run()` owns the optimistic UI + rollback around it. */
  setRoutingStatus: (status: CurrentAgent['routing_status']) => Promise<void>;
}

/** A static catalogue entry: the twin of `NavDestination`, for act rather than go-to. */
export interface ActionRecord {
  id: string;
  /** Computed rather than fixed text, since this entry's label depends on live state. */
  label: (deps: ActionDeps) => string;
  /** Extra words the palette matches besides the label — same role as `NavDestination.keywords`. */
  keywords: string[];
  /**
   * Scopes that let the caller use this action — an "any of" list, mirroring how
   * the target endpoint itself accepts more than one scope (`agents.ts`
   * `PUT /agents/me/routing-status`). The palette hides the entry unless the
   * caller holds at least one (01.1.3-ai-b); the endpoint enforces it again
   * regardless, so hiding it is a UX courtesy, not the security boundary.
   */
  requiredScope: string[];
  /**
   * Performs the action, optimistic guess and rollback included. It rejects when
   * the underlying request did — after undoing its own guess — so the caller's
   * only remaining job is to tell the person that nothing happened. Swallowing
   * the rejection here would leave the palette insisting the toggle worked.
   */
  run: (deps: ActionDeps) => Promise<void>;
}

/**
 * One entry so far, matching the PRD's concrete example ("Stop Accepting
 * Chats"). Extending this list later needs no palette change — the same
 * courtesy `NAV_DESTINATIONS` gives the icon rail.
 */
export const ACTIONS: ActionRecord[] = [
  {
    id: 'toggle-accepting-chats',
    label: (deps) =>
      deps.agent?.routing_status === 'accepting_chats'
        ? 'Stop Accepting Chats'
        : 'Start Accepting Chats',
    keywords: [
      'stop accepting chats',
      'start accepting chats',
      'accepting chats',
      'routing status',
      'go online',
      'go offline',
    ],
    requiredScope: ['agents--my:rw', 'agents--all:rw'],
    run: async (deps) => {
      const previous = deps.agent?.routing_status;
      const next: CurrentAgent['routing_status'] =
        previous === 'accepting_chats' ? 'not_accepting_chats' : 'accepting_chats';

      // Show it first. Availability is the one setting an agent changes while
      // the queue is moving, and waiting a round trip to see it flip is exactly
      // when someone toggles twice and ends up back where they started.
      deps.applyRoutingStatus(next);
      try {
        await deps.setRoutingStatus(next);
      } catch (error) {
        // The server said no — put the old value back before anyone acts on the
        // guess. `previous` is only absent when there is no session at all, and
        // then there was no visible state to restore either.
        if (previous) deps.applyRoutingStatus(previous);
        throw error;
      }
    },
  },
];

/**
 * The palette's one result shape, replacing the two separate ad-hoc shapes
 * `CommandPalette.tsx` used to build inline for route jumps and content
 * search hits — same fields, now carrying a `kind` so a result can say which
 * catalogue produced it. `action` (this file) and `ai` (01.1.3-ai-d..f) are
 * part of the union from this turn on so later turns extend a type that
 * already expects them, rather than widening it under pressure.
 */
export interface PaletteResult {
  kind: 'nav' | 'content' | 'action' | 'ai';
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: string;
  run: () => void;
}
