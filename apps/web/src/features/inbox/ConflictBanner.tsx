import type { ReactElement } from 'react';
import { useConflictStore } from './conflict.js';

/**
 * "N agents are typing in this chat", for when two or more agents compose a
 * reply to the same chat at once (FR-MOD-08.6.3).
 *
 * Renders nothing when there is no live conflict, so it can sit above the
 * composer without reserving space, and clears itself once the store's idle
 * timer lapses the entry — no dismiss action, matching the store's
 * self-clearing behaviour.
 */
export function ConflictBanner({ chatId }: { chatId: string }): ReactElement | null {
  const conflict = useConflictStore((state) => state.byChat[chatId]);
  if (!conflict) return null;

  const count = conflict.agents.length;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="conflict-banner"
      className="flex shrink-0 items-center gap-2 border-t border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning"
    >
      <WarningIcon />
      <span>
        Bu sohbette {count} ajan aynı anda yazıyor:{' '}
        <span className="font-medium">
          {conflict.agents.map((agent) => agent.agentId).join(', ')}
        </span>
      </span>
    </div>
  );
}

function WarningIcon(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-current">
      <path d="M8 1.5a1 1 0 0 1 .878.52l6.25 11.5A1 1 0 0 1 14.25 15H1.75a1 1 0 0 1-.878-1.48l6.25-11.5A1 1 0 0 1 8 1.5Zm0 4.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 5.75Zm0 6a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Z" />
    </svg>
  );
}
