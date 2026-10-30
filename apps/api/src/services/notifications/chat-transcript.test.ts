import { describe, expect, it } from 'vitest';
import {
  renderTranscript,
  transcriptMessages,
  transcriptRecipients,
  type TranscriptLine,
} from './chat-transcript.js';

describe('transcriptRecipients', () => {
  const assignee = { email: 'agent@example.test', name: 'Ada', emailEnabled: true };
  const noForward = { to: [], includeNotes: false };

  it('never mails the player at close, only the human who handled the chat (K26 · FR-MOD-08.7.4)', () => {
    const to = transcriptRecipients({ assignee, forward: noForward });
    expect(to).toEqual([{ party: 'team', to: 'agent@example.test', name: 'Ada', via: 'assignee' }]);
  });

  it('skips the team copy for an AI-only / queued chat with no assignee', () => {
    expect(transcriptRecipients({ assignee: null, forward: noForward })).toEqual([]);
  });

  it('honours the agent e-mail opt-out for the team copy (FR-MOD-08.2)', () => {
    const to = transcriptRecipients({
      assignee: { ...assignee, emailEnabled: false },
      forward: noForward,
    });
    expect(to).toEqual([]);
  });

  it('does not send to an empty address', () => {
    const to = transcriptRecipients({
      assignee: { ...assignee, email: '' },
      forward: { to: [''], includeNotes: false },
    });
    expect(to).toEqual([]);
  });

  it("forwards the player's copy to each address on its own (WG-06)", () => {
    const to = transcriptRecipients({
      assignee: null,
      forward: { to: ['arsiv@sirket.com', 'uyum@sirket.com'], includeNotes: false },
    });
    expect(to).toEqual([
      { party: 'customer', to: 'arsiv@sirket.com', name: null, via: 'forward' },
      { party: 'customer', to: 'uyum@sirket.com', name: null, via: 'forward' },
    ]);
  });

  it("forwards the team's copy when the workspace includes notes, and mails an address once", () => {
    const to = transcriptRecipients({
      assignee,
      forward: {
        to: ['Agent@example.test', 'arsiv@sirket.com', 'arsiv@sirket.com'],
        includeNotes: true,
      },
    });
    expect(to.map((r) => `${r.via}:${r.party}:${r.to}`)).toEqual([
      'assignee:team:agent@example.test',
      'forward:team:arsiv@sirket.com',
    ]);
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

describe('transcriptMessages (AR-04 · tm 338)', () => {
  const lines: TranscriptLine[] = [
    {
      authorType: 'customer',
      authorName: null,
      text: 'Here is the receipt',
      type: 'message',
      recipients: 'all',
      createdAt: new Date('2026-10-20T07:15:00.000Z'),
      attachmentName: 'dekont.pdf',
    },
    {
      authorType: 'agent',
      authorName: 'Ada',
      text: 'KYC pending',
      type: 'message',
      recipients: 'agents',
      createdAt: new Date('2026-10-20T07:16:00.000Z'),
    },
  ];

  it("names a file without a link, and points the team's copy at the panel", () => {
    const team = transcriptMessages({
      audience: 'team',
      customerName: 'Ayşe',
      lines,
      locale: 'tr',
      fileNote: true,
    });
    expect(team.map((m) => [m.role, m.who, m.text])).toEqual([
      ['customer', 'Ayşe', 'Here is the receipt\n(dosya: dekont.pdf — panelde görüntüleyin)'],
      ['note', 'Ada · dahili not', 'KYC pending'],
    ]);
  });

  it("leaves every internal note out of the player's copy", () => {
    const customer = transcriptMessages({
      audience: 'customer',
      customerName: null,
      lines,
      locale: 'en',
    });
    expect(customer.map((m) => m.text)).toEqual(['Here is the receipt\n(file: dekont.pdf)']);
  });
});
