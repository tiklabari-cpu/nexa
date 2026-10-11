import { describe, expect, it } from 'vitest';
import { renderTranscript, transcriptRecipients, type TranscriptLine } from './chat-transcript.js';

describe('transcriptRecipients', () => {
  const assignee = { email: 'agent@example.test', name: 'Ada', emailEnabled: true };

  it('mails both the visitor and the human who handled the chat', () => {
    const to = transcriptRecipients({
      customer: { email: 'visitor@example.test', name: 'Vic' },
      assignee,
    });
    expect(to).toEqual([
      { party: 'customer', to: 'visitor@example.test', name: 'Vic' },
      { party: 'team', to: 'agent@example.test', name: 'Ada' },
    ]);
  });

  it('skips the visitor when we never captured an address', () => {
    const to = transcriptRecipients({ customer: { email: null, name: 'Vic' }, assignee });
    expect(to.map((r) => r.party)).toEqual(['team']);
  });

  it('skips the team copy for an AI-only / queued chat with no assignee', () => {
    const to = transcriptRecipients({
      customer: { email: 'visitor@example.test', name: 'Vic' },
      assignee: null,
    });
    expect(to.map((r) => r.party)).toEqual(['customer']);
  });

  it('honours the agent e-mail opt-out for the team copy (FR-MOD-08.2)', () => {
    const to = transcriptRecipients({
      customer: { email: 'visitor@example.test', name: 'Vic' },
      assignee: { ...assignee, emailEnabled: false },
    });
    expect(to.map((r) => r.party)).toEqual(['customer']);
  });

  it('does not send to an empty address', () => {
    const to = transcriptRecipients({
      customer: { email: '', name: 'Vic' },
      assignee: { ...assignee, email: '' },
    });
    expect(to).toEqual([]);
  });
});

describe('renderTranscript', () => {
  const at = (iso: string) => new Date(iso);
  /** Istanbul is UTC+3 all year: 10:00Z reads 13:00. */
  const frame = { workspaceName: 'Acme', timeZone: 'Europe/Istanbul', locale: 'en' as const };
  const lines: TranscriptLine[] = [
    {
      authorType: 'customer',
      authorName: null,
      text: 'My order is late',
      type: 'message',
      recipients: 'all',
      createdAt: at('2026-07-26T10:00:00.000Z'),
    },
    {
      authorType: 'agent',
      authorName: 'Ada',
      text: 'Let me check on that',
      type: 'message',
      recipients: 'all',
      createdAt: at('2026-07-26T10:01:00.000Z'),
    },
    {
      authorType: 'agent',
      authorName: 'Ada',
      text: 'VIP — refund pre-approved',
      type: 'message',
      recipients: 'agents',
      createdAt: at('2026-07-26T10:02:00.000Z'),
    },
    {
      authorType: 'system',
      authorName: null,
      text: 'Chat archived',
      type: 'system_message',
      recipients: 'all',
      createdAt: at('2026-07-26T10:03:00.000Z'),
    },
  ];

  it("keeps the internal note out of the customer's copy", () => {
    const content = renderTranscript({
      audience: 'customer',
      chatId: 'CHAT12345678',
      customerName: 'Vic',
      lines,
      frame,
    });
    expect(content).not.toBeNull();
    expect(content!.subject).toBe('Your conversation with Acme');
    // The note addressed to agents must never surface to the visitor —
    // in either half of the message.
    for (const part of [content!.body, content!.html]) {
      expect(part).toContain('My order is late');
      expect(part).toContain('Let me check on that');
      expect(part).not.toContain('refund pre-approved');
    }
    // Each line is labelled with its author and read in the workspace's zone.
    expect(content!.body).toContain('[13:00] Vic: My order is late');
    expect(content!.body).toContain('[13:01] Ada: Let me check on that');
    expect(content!.body).toContain('Sunday, 26 July 2026');
    expect(content!.body).toContain('Times are in Europe/Istanbul time.');
    expect(content!.body).toContain('Conversation ID: CHAT12345678');
    // A visitor gets no link to the agent panel.
    expect(content!.html).not.toMatch(/href="https?:/);
  });

  it('writes the team copy in the assignee language, notes marked as notes', () => {
    const content = renderTranscript({
      audience: 'team',
      chatId: 'CHAT12345678',
      customerName: 'Vic',
      lines,
      frame: { ...frame, locale: 'tr' },
    });
    expect(content!.subject).toBe('Sohbet dökümü: Vic (CHAT12345678)');
    expect(content!.body).toContain('[13:02] Ada · dahili not: VIP — refund pre-approved');
    expect(content!.body).toContain('26 Temmuz 2026 Pazar');
    expect(content!.html).toContain('lang="tr"');
  });

  it("includes the internal note in the team's copy", () => {
    const content = renderTranscript({
      audience: 'team',
      chatId: 'CHAT12345678',
      customerName: 'Vic',
      lines,
      frame,
    });
    expect(content).not.toBeNull();
    expect(content!.subject).toContain('Vic');
    expect(content!.body).toContain('refund pre-approved');
    expect(content!.body).toContain('Ada · internal note');
  });

  it('renders nothing when the chat carried only system events', () => {
    const systemOnly: TranscriptLine[] = [
      {
        authorType: 'system',
        authorName: null,
        text: 'Chat archived',
        type: 'system_message',
        recipients: 'all',
        createdAt: at('2026-07-26T10:00:00.000Z'),
      },
    ];
    expect(
      renderTranscript({
        audience: 'customer',
        chatId: 'C',
        customerName: null,
        lines: systemOnly,
        frame,
      }),
    ).toBeNull();
    expect(
      renderTranscript({
        audience: 'team',
        chatId: 'C',
        customerName: null,
        lines: systemOnly,
        frame,
      }),
    ).toBeNull();
  });

  it('falls back to a type marker for an event with no text (e.g. a file)', () => {
    const withFile: TranscriptLine[] = [
      {
        authorType: 'customer',
        authorName: null,
        text: null,
        type: 'file',
        recipients: 'all',
        createdAt: at('2026-07-26T10:00:00.000Z'),
      },
    ];
    const content = renderTranscript({
      audience: 'customer',
      chatId: 'C',
      customerName: null,
      lines: withFile,
      frame,
    });
    expect(content!.body).toContain('Visitor: (sent a file)');
  });
});
