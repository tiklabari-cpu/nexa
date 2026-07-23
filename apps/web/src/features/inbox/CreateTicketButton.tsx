/**
 * "Create ticket" on an open conversation (PRD FR-MOD-02.6).
 *
 * The interesting case is the second click. A chat may have only one unresolved
 * ticket, and the API answers a repeat with the id of the one that already
 * exists — so this offers to open it rather than reporting a failure. An agent
 * who clicks twice did not make a mistake worth a red banner; they wanted the
 * ticket, and it is right there.
 */
import { useState, type ReactElement } from 'react';
import { existingTicketIdOf, useCreateTicketFromChat } from './useTickets.js';

export function CreateTicketButton({
  chatId,
  customerName,
  onOpenTicket,
}: {
  chatId: string;
  customerName: string | null;
  onOpenTicket: (ticketId: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const create = useCreateTicketFromChat();

  const existingId = existingTicketIdOf(create.error);

  function start(): void {
    setSubject(`Follow-up for ${customerName ?? 'visitor'}`);
    create.reset();
    setOpen(true);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-2"
      >
        Create ticket
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="new-ticket-subject" className="sr-only">
        Ticket subject
      </label>
      <input
        id="new-ticket-subject"
        value={subject}
        autoFocus
        onChange={(event) => setSubject(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="w-64 rounded-md border border-border bg-inset px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={subject.trim().length === 0 || create.isPending}
        onClick={() => {
          create.mutate(
            { chatId, subject: subject.trim() },
            {
              onSuccess: (ticket) => {
                setOpen(false);
                onOpenTicket(ticket.id);
              },
            },
          );
        }}
        className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1 text-xs text-content-tertiary hover:text-content"
      >
        Cancel
      </button>

      {existingId && (
        <span role="status" className="flex items-center gap-2 text-xs text-content-secondary">
          Already has one.
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenTicket(existingId);
            }}
            className="font-medium text-brand-600 underline"
          >
            Open it
          </button>
        </span>
      )}
      {create.isError && !existingId && (
        <span role="alert" className="text-xs text-danger">
          Could not create that ticket.
        </span>
      )}
    </div>
  );
}
