/**
 * "Create ticket" on an open conversation (PRD FR-MOD-02.6).
 *
 * The interesting case is the second click. A chat may have only one unresolved
 * ticket, and the API answers a repeat with the id of the one that already
 * exists — so this offers to open it rather than reporting a failure. An agent
 * who clicks twice did not make a mistake worth a red banner; they wanted the
 * ticket, and it is right there.
 *
 * The subject field is a card under the header, not a field in it (tm 259.12 ·
 * UX audit O3): a 256 px input in a header that has 284 px pushed the Details
 * panel off the screen. The button stays where it was, so the header never
 * changes size while the agent types.
 */
import { useState, type ReactElement } from 'react';
import { existingTicketIdOf, useCreateTicketFromChat } from './useTickets.js';
import { useTranslate } from '../../lib/i18n.js';
import { actionClass } from './headerAction.js';

export function CreateTicketButton({
  chatId,
  customerName,
  onOpenTicket,
  compact = false,
}: {
  chatId: string;
  customerName: string | null;
  onOpenTicket: (ticketId: string) => void;
  /** An icon with the same accessible name, for a header with no room for words. */
  compact?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const create = useCreateTicketFromChat();
  const t = useTranslate();

  const existingId = existingTicketIdOf(create.error);

  function start(): void {
    setSubject(
      t('inbox.createTicket.subjectTemplate', {
        customer: customerName ?? t('inbox.createTicket.visitorFallback'),
      }),
    );
    create.reset();
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={open ? () => setOpen(false) : start}
        aria-expanded={open}
        aria-label={t('inbox.createTicket.cta')}
        title={t('inbox.createTicket.cta')}
        className={actionClass(compact)}
      >
        {compact ? <span aria-hidden="true">▤</span> : t('inbox.createTicket.cta')}
      </button>

      {open && (
        // Positioned against the header (`relative` there), under it and
        // right-aligned with the actions; never wider than the column it hangs from.
        <div
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="absolute right-3 top-full z-20 mt-1 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-md"
        >
          <label htmlFor="new-ticket-subject" className="sr-only">
            {t('inbox.createTicket.subjectLabel')}
          </label>
          <input
            id="new-ticket-subject"
            value={subject}
            autoFocus
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-md border border-border bg-inset px-2 py-1 text-xs"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-1 text-xs text-content-tertiary hover:text-content"
            >
              {t('inbox.createTicket.cancel')}
            </button>
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
              {t('inbox.createTicket.create')}
            </button>
          </div>

          {existingId && (
            <p role="status" className="text-xs text-content-secondary">
              {t('inbox.createTicket.alreadyExists')}{' '}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenTicket(existingId);
                }}
                className="font-medium text-content-brand underline"
              >
                {t('inbox.createTicket.openExisting')}
              </button>
            </p>
          )}
          {create.isError && !existingId && (
            <p role="alert" className="text-xs text-danger">
              {t('inbox.createTicket.error')}
            </p>
          )}
        </div>
      )}
    </>
  );
}
