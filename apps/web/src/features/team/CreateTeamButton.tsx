/**
 * Create a team from outside the Teams screen (FR-MOD-04.1).
 *
 * `Teams.tsx` already owns a "New team" button, but its open/closed state is
 * local to that component's `editing: Group | 'new' | null` union, which also
 * drives the per-card edit form — there is no seam to reuse just the create
 * half from the shell's "+" menu. This wraps the same `TeamEditor` (unchanged,
 * still the one form both paths submit through) behind its own trigger, the
 * same `trigger` render-prop contract `InviteTeammates` already uses so the
 * rail can open either without a second copy of the modal (CONVENTIONS §5).
 */
import { useState, type ReactElement } from 'react';
import { TeamEditor } from './TeamEditor.js';

export function CreateTeamButton({
  trigger,
}: {
  /** Custom trigger renderer, given the `open` callback. */
  trigger: (open: () => void) => ReactElement;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <TeamEditor
          group={null}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
          onDeleted={() => setOpen(false)}
        />
      )}
    </>
  );
}
