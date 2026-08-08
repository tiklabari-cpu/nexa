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
 * the caller is accepting chats. `run()` is a real implementation, not a
 * placeholder — it already calls the same store action the Team/Inbox toggles
 * use — but the palette does not invoke it yet. Filtering unauthorized entries
 * out of the result list (01.1.3-ai-b) and wiring selection up to `run()` with
 * optimistic UI and rollback (01.1.3-ai-c) are later, separate turns; wiring
 * before the scope gate exists would let an unauthorized agent trigger an
 * action the palette had no business offering it.
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
  /** Performs the underlying request; the caller owns optimistic UI + rollback. */
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
      const next: CurrentAgent['routing_status'] =
        deps.agent?.routing_status === 'accepting_chats'
          ? 'not_accepting_chats'
          : 'accepting_chats';
      await deps.setRoutingStatus(next);
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
