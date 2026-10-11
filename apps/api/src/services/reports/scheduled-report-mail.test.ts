import { describe, expect, it } from 'vitest';
import { buildScheduledReportMail } from './scheduled-report-mail.js';

const BASE = {
  groupLabel: 'Sales',
  periodFrom: new Date('2026-07-01T00:00:00.000Z'),
  periodTo: new Date('2026-07-26T23:59:59.000Z'),
  csv: 'date,chats\r\n2026-07-20,3\r\n',
  rowCount: 1,
  filename: 'siyahtus-sales-2026-07-01-2026-07-26.csv',
  workspaceName: 'Acme',
  locale: 'en' as const,
};

describe('buildScheduledReportMail (tm 265)', () => {
  it('names the group, the UTC period and the row count, and attaches the CSV', () => {
    const content = buildScheduledReportMail(BASE);

    expect(content.subject).toBe('Scheduled report: Sales (2026-07-01 – 2026-07-26)');
    expect(content.body).toContain('Period: 2026-07-01 – 2026-07-26');
    expect(content.body).toContain('Rows: 1');
    expect(content.body).toContain('File: siyahtus-sales-2026-07-01-2026-07-26.csv');
    // The data travels as a file, not pasted into the message.
    expect(content.body).not.toContain('2026-07-20,3');
    expect(content.attachments).toEqual([
      {
        filename: 'siyahtus-sales-2026-07-01-2026-07-26.csv',
        contentType: 'text/csv; charset=utf-8',
        // The byte-order mark Excel needs to read UTF-8, then the file.
        content: '﻿date,chats\r\n2026-07-20,3\r\n',
      },
    ]);
    expect(content.html).toContain('Sales report');
  });

  it('pluralises the row count in the preheader', () => {
    const content = buildScheduledReportMail({ ...BASE, rowCount: 2 });
    expect(content.html).toContain('2 rows, attached as a CSV file.');
  });

  it('says plainly when a period had no data', () => {
    const content = buildScheduledReportMail({ ...BASE, rowCount: 0, csv: 'date,chats\r\n' });
    expect(content.body).toContain('There was no data for 2026-07-01 – 2026-07-26.');
    expect(content.attachments[0]!.content).toBe('﻿date,chats\r\n');
  });

  it('writes the message in Turkish for a Turkish-speaking recipient', () => {
    const content = buildScheduledReportMail({ ...BASE, locale: 'tr' });
    expect(content.subject).toBe('Planlı rapor: Sales (2026-07-01 – 2026-07-26)');
    expect(content.body).toContain('Dönem: 2026-07-01 – 2026-07-26');
    expect(content.locale).toBe('tr');
  });
});
