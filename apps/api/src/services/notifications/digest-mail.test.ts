import { describe, expect, it } from 'vitest';
import { digestMail, type DigestMailFigures } from '../mail/templates/messages.js';

const QUIET: DigestMailFigures = {
  chats: 0,
  closed: 0,
  missed: 0,
  avg_first_response_seconds: null,
  csat_score: null,
  csat_responses: 0,
  ai_conversations: 0,
  ai_resolved: 0,
  ai_handed_off: 0,
  risk_flagged_chats: 0,
  queue_entries: 0,
  queue_p80_wait_seconds: null,
};

const BUSY: DigestMailFigures = {
  chats: 42,
  closed: 40,
  missed: 3,
  avg_first_response_seconds: 80,
  csat_score: 0.92,
  csat_responses: 25,
  ai_conversations: 30,
  ai_resolved: 18,
  ai_handed_off: 7,
  risk_flagged_chats: 2,
  queue_entries: 9,
  queue_p80_wait_seconds: 125,
};

const BEFORE: DigestMailFigures = {
  ...BUSY,
  chats: 38,
  missed: 5,
  avg_first_response_seconds: 95,
  csat_score: 0.95,
  risk_flagged_chats: 2,
  queue_p80_wait_seconds: 125,
};

const input = {
  workspaceName: 'Acme',
  frequency: 'daily' as const,
  periodLabel: '2026-11-01',
  scope: 'workspace' as const,
  current: BUSY,
  previous: BEFORE,
};

describe('digestMail (RP-05)', () => {
  it('states each figure with its change against the period before', () => {
    const mail = digestMail({ locale: 'en' }, input);
    expect(mail.subject).toBe('Daily summary: Acme · 2026-11-01');
    expect(mail.body).toContain('Chats: 42 (+4)');
    expect(mail.body).toContain('Missed chats: 3 (−2)');
    expect(mail.body).toContain('First reply (average): 1 min 20 s (−15 s)');
    expect(mail.body).toContain('Satisfaction: 92% (25 ratings) (−3 pts)');
    expect(mail.body).toContain('Resolved by AI: 18 (±0)');
    expect(mail.body).toContain('Handed over by AI: 7 (±0)');
    expect(mail.body).toContain('Chats with a risk flag: 2 (±0)');
    expect(mail.body).toContain('Queue wait (80th percentile): 2 min 5 s (±0)');
  });

  it('shows a dash, and no change, for what has no value (a quiet day)', () => {
    const mail = digestMail({ locale: 'en' }, { ...input, current: QUIET, previous: BUSY });
    expect(mail.body).toContain('First reply (average): —');
    expect(mail.body).toContain('Satisfaction: —');
    expect(mail.body).toContain('Queue wait (80th percentile): —');
    expect(mail.body).toContain('Chats: 0 (−42)');
  });

  it('compares nothing against an empty previous period', () => {
    const mail = digestMail({ locale: 'en' }, { ...input, previous: QUIET });
    expect(mail.body).toContain('First reply (average): 1 min 20 s\n');
    expect(mail.body).toContain('Chats: 42 (+42)');
  });

  it('writes in Turkish for a Turkish reader', () => {
    const mail = digestMail(
      { locale: 'tr' },
      { ...input, frequency: 'weekly', periodLabel: '2026-10-26 – 2026-11-01' },
    );
    expect(mail.subject).toBe('Haftalık özet: Acme · 2026-10-26 – 2026-11-01');
    expect(mail.body).toContain('Kaçan sohbet: 3 (−2)');
    expect(mail.body).toContain('İlk yanıt (ortalama): 1 dk 20 sn (−15 sn)');
    expect(mail.body).toContain('Memnuniyet: %92 (25 oy) (−3 puan)');
    expect(mail.body).toContain('Kuyrukta bekleme (80. yüzdelik)');
  });

  it('says whose figures they are when the reader leads teams', () => {
    const workspace = digestMail({ locale: 'en' }, input);
    const teams = digestMail({ locale: 'en' }, { ...input, scope: 'teams' });
    expect(teams.body).toContain('only the teams you lead');
    expect(workspace.body).not.toContain('only the teams you lead');
  });

  it('links to the Reports screen only when given an address, and carries ids and nothing else', () => {
    expect(digestMail({ locale: 'en' }, input).html).not.toContain('Open reports');
    const url = 'https://panel.example.test/app/reports?group_id=7&group_id=9';
    const mail = digestMail(
      { locale: 'en', appUrl: 'https://panel.example.test' },
      { ...input, reportsUrl: url },
    );
    expect(mail.html).toContain('Open reports');
    expect(mail.html).toContain('group_id=7&amp;group_id=9');
  });

  it('has nowhere to put a player’s details: the figures are numbers, and the body names no address', () => {
    const mail = digestMail({ locale: 'en' }, input);
    const whole = [mail.subject, mail.body, mail.html].join('\n');
    expect(whole).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    for (const value of Object.values(BUSY)) {
      expect(value === null || typeof value === 'number').toBe(true);
    }
  });
});
