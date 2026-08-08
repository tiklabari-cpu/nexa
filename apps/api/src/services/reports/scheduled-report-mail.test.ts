import { describe, expect, it } from 'vitest';
import { buildScheduledReportMail } from './scheduled-report-mail.js';

describe('buildScheduledReportMail', () => {
  it('carries the group, the UTC period and the row count in the subject and body, and embeds the CSV', () => {
    const content = buildScheduledReportMail({
      groupLabel: 'Sales',
      periodFrom: new Date('2026-07-01T00:00:00.000Z'),
      periodTo: new Date('2026-07-26T23:59:59.000Z'),
      csv: 'date,chats\r\n2026-07-20,3\r\n',
      rowCount: 1,
      filename: 'nexa-sales-2026-07-01-2026-07-26.csv',
    });

    expect(content.subject).toBe('Scheduled report: Sales (2026-07-01 – 2026-07-26)');
    expect(content.body).toContain('Sales — 2026-07-01 to 2026-07-26');
    expect(content.body).toContain('1 row.');
    expect(content.body).toContain('File: nexa-sales-2026-07-01-2026-07-26.csv');
    expect(content.body).toContain('date,chats\r\n2026-07-20,3\r\n');
  });

  it('pluralises row counts above one', () => {
    const content = buildScheduledReportMail({
      groupLabel: 'Overview',
      periodFrom: new Date('2026-07-01T00:00:00.000Z'),
      periodTo: new Date('2026-07-01T00:00:00.000Z'),
      csv: 'a,b\r\n1,2\r\n3,4\r\n',
      rowCount: 2,
      filename: 'nexa-overview-2026-07-01-2026-07-01.csv',
    });

    expect(content.body).toContain('2 rows.');
  });

  it('says so explicitly when a period has no rows, rather than an empty-looking body', () => {
    const content = buildScheduledReportMail({
      groupLabel: 'Leads',
      periodFrom: new Date('2026-07-01T00:00:00.000Z'),
      periodTo: new Date('2026-07-07T00:00:00.000Z'),
      csv: 'date,leads\r\n',
      rowCount: 0,
      filename: 'nexa-leads-2026-07-01-2026-07-07.csv',
    });

    expect(content.body).toContain('No rows for this period.');
    expect(content.body).not.toMatch(/\b0 rows?\b/);
  });
});
