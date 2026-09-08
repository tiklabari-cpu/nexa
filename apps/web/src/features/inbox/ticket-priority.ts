/**
 * Ticket priority as a small, named scale (FR-MOD-13.6, HelpDesk layer).
 *
 * The column is a signed integer bounded to ±100 (PRD/@nexa/types), which a raw
 * number field would expose as an open-ended box nobody can reason about. The UI
 * instead offers four labelled levels and snaps whatever value the API returns
 * to the nearest one — so a priority set through the API to some in-between value
 * still renders as a level rather than a bare number.
 */
import {
  TICKET_PRIORITY_BANDS,
  TICKET_PRIORITY_DEFAULT,
  nearestTicketPriorityBand,
  type TicketPriorityBand,
} from '@nexa/types';

export type PriorityTone = 'danger' | 'warning' | 'neutral';

export interface PriorityLevel {
  value: number;
  label: string;
  tone: PriorityTone;
}

/**
 * How urgent a level *looks*. Which levels exist and what each is called is
 * `@nexa/types`' (`TICKET_PRIORITY_BANDS`), shared with the ticket e-mail
 * templates that may print `{{ticket.priority}}` to a customer. Only the colour
 * is the console's own business, so only the colour lives here.
 */
const TONE_BY_LABEL: Record<TicketPriorityBand['label'], PriorityTone> = {
  Urgent: 'danger',
  High: 'warning',
  Normal: 'neutral',
  Low: 'neutral',
};

/** Highest first, so a `<select>` reads urgent → low top to bottom. */
export const TICKET_PRIORITIES: readonly PriorityLevel[] = TICKET_PRIORITY_BANDS.map((band) => ({
  value: band.value,
  label: band.label,
  tone: TONE_BY_LABEL[band.label],
}));

/**
 * Snap an arbitrary stored priority to the nearest named level. On a tie the
 * more urgent level wins — a value halfway between High and Normal reads as the
 * one that gets attention sooner, which is the safer default to surface.
 *
 * The snapping itself is the shared rule, so the pane and a rendered e-mail can
 * never call the same stored number two different things.
 */
export function nearestPriority(value: number): PriorityLevel {
  const band = nearestTicketPriorityBand(value);
  return { value: band.value, label: band.label, tone: TONE_BY_LABEL[band.label] };
}

/** True when a ticket carries a non-default priority worth flagging in a list. */
export function hasElevatedPriority(value: number): boolean {
  return value !== TICKET_PRIORITY_DEFAULT;
}
