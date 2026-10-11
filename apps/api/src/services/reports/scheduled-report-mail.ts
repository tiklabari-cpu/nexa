/**
 * The scheduled-report delivery e-mail (07.9-sched-d1).
 *
 * Since tm 265 the report travels as what it is — a CSV file attached to the
 * message — and the message itself says which report, which UTC period and how
 * many rows, in the recipient's language, inside the shared template. Before,
 * the mailer had no attachment channel and the CSV was pasted into the body.
 *
 * What stays pure here is the content: the period and the row count are spelled
 * out so a recipient — or a test reading the mailbox — never has to open the
 * file to know what arrived. A period with zero rows is not an error (a quiet
 * day is a valid outcome for a recurring export); the message says so, and the
 * attachment carries the header row alone.
 */
import type { MailAttachment } from '../mail/mime.js';
import type { MailLocale, RenderedEmail } from '../mail/templates/layout.js';
import { scheduledReportMail } from '../mail/templates/messages.js';

export interface ScheduledReportMailInput {
  /** Catalogue label, e.g. `reportGroup(id)?.label` — not the raw group id. */
  groupLabel: string;
  /** Inclusive UTC period start. */
  periodFrom: Date;
  /** Inclusive UTC period end. */
  periodTo: Date;
  /** The exported report, already serialised (07.9-sched-d2 produces this). */
  csv: string;
  /** Row count, excluding the header — drives the "no rows" wording. */
  rowCount: number;
  /** The file's name, e.g. from `exportFilename()`. */
  filename: string;
  /** Whose report it is — shown above the heading and in the footer. */
  workspaceName: string;
  locale: MailLocale;
  /** `WEB_APP_URL`, when known — linked from the mark. */
  appUrl?: string;
}

export interface ScheduledReportMailContent extends RenderedEmail {
  attachments: MailAttachment[];
}

/**
 * A byte-order mark in front of the CSV: without it Excel reads a UTF-8 file
 * in the machine's legacy code page, and every "ş" and "ğ" in a name arrives
 * broken. Every other reader ignores it.
 */
const UTF8_BOM = '﻿';

/** Builds the message for one scheduled delivery. */
export function buildScheduledReportMail(
  input: ScheduledReportMailInput,
): ScheduledReportMailContent {
  const rendered = scheduledReportMail(
    { locale: input.locale, ...(input.appUrl ? { appUrl: input.appUrl } : {}) },
    {
      workspaceName: input.workspaceName,
      reportLabel: input.groupLabel,
      from: utcDay(input.periodFrom),
      to: utcDay(input.periodTo),
      rowCount: input.rowCount,
      filename: input.filename,
    },
  );
  return {
    ...rendered,
    attachments: [
      {
        filename: input.filename,
        contentType: 'text/csv; charset=utf-8',
        content: `${UTF8_BOM}${input.csv}`,
      },
    ],
  };
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
