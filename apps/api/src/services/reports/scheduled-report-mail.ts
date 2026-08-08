/**
 * The scheduled-report delivery e-mail (07.9-sched-d1) — subject and body only.
 *
 * `FileMailer` writes a message's `body` as plain text and has no attachment
 * channel (see `mailer.ts`), so a scheduled export's CSV has nowhere to live
 * but inside the body — anything else would claim a MIME capability this mock
 * provider does not have. What is worth keeping pure here, apart from that
 * placement, is the *content*: which report group and UTC period the mail is
 * about, and how many rows it carries, both spelled out explicitly so a
 * recipient — or a test reading the mailbox — never has to parse the CSV to
 * know what arrived. A period with zero rows is not an error (a quiet day is a
 * valid outcome for a recurring export), so it still gets a sentence that says
 * so rather than a body that is a lone header row.
 */

export interface ScheduledReportMailInput {
  /** Catalogue label, e.g. `reportGroup(id)?.label` — not the raw group id. */
  groupLabel: string;
  /** Inclusive UTC period start. */
  periodFrom: Date;
  /** Inclusive UTC period end. */
  periodTo: Date;
  /** The exported report, already serialised (07.9-sched-d2 produces this). */
  csv: string;
  /** Row count, excluding the header — drives the "no rows" wording below. */
  rowCount: number;
  /** The download name the CSV would have had, e.g. from `exportFilename()`. */
  filename: string;
}

export interface ScheduledReportMailContent {
  subject: string;
  body: string;
}

/** Builds the subject/body for one scheduled delivery. */
export function buildScheduledReportMail(
  input: ScheduledReportMailInput,
): ScheduledReportMailContent {
  const from = utcDay(input.periodFrom);
  const to = utcDay(input.periodTo);
  const subject = `Scheduled report: ${input.groupLabel} (${from} – ${to})`;

  const rows =
    input.rowCount === 0
      ? 'No rows for this period.'
      : `${input.rowCount} row${input.rowCount === 1 ? '' : 's'}.`;

  const body = [
    `${input.groupLabel} — ${from} to ${to}`,
    rows,
    `File: ${input.filename}`,
    '',
    input.csv,
  ].join('\n');

  return { subject, body };
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
