/**
 * Ticket priority as a small, named scale (FR-MOD-13.6, HelpDesk layer).
 *
 * The column is a signed integer bounded to ±100 (PRD/@nexa/types), which a raw
 * number field would expose as an open-ended box nobody can reason about. The UI
 * instead offers four labelled levels and snaps whatever value the API returns
 * to the nearest one — so a priority set through the API to some in-between value
 * still renders as a level rather than a bare number.
 */
import { TICKET_PRIORITY_DEFAULT } from '@nexa/types';

export type PriorityTone = 'danger' | 'warning' | 'neutral';

export interface PriorityLevel {
  value: number;
  label: string;
  tone: PriorityTone;
}

/** Highest first, so a `<select>` reads urgent → low top to bottom. */
export const TICKET_PRIORITIES: readonly PriorityLevel[] = [
  { value: 100, label: 'Urgent', tone: 'danger' },
  { value: 50, label: 'High', tone: 'warning' },
  { value: TICKET_PRIORITY_DEFAULT, label: 'Normal', tone: 'neutral' },
  { value: -50, label: 'Low', tone: 'neutral' },
];

/**
 * Snap an arbitrary stored priority to the nearest named level. On a tie the
 * more urgent level wins — a value halfway between High and Normal reads as the
 * one that gets attention sooner, which is the safer default to surface.
 */
export function nearestPriority(value: number): PriorityLevel {
  return TICKET_PRIORITIES.reduce((best, level) => {
    const distance = Math.abs(level.value - value);
    const bestDistance = Math.abs(best.value - value);
    if (distance < bestDistance || (distance === bestDistance && level.value > best.value)) {
      return level;
    }
    return best;
  });
}

/** True when a ticket carries a non-default priority worth flagging in a list. */
export function hasElevatedPriority(value: number): boolean {
  return value !== TICKET_PRIORITY_DEFAULT;
}
