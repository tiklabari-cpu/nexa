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
    });
    expect(content).not.toBeNull();
    expect(content!.subject).toMatch(/your chat transcript/i);
    expect(content!.body).toContain('My order is late');
    expect(content!.body).toContain('Let me check on that');
    // The note addressed to agents must never surface to the visitor.
    expect(content!.body).not.toContain('refund pre-approved');
    // The visitor's own line is labelled with their name, the agent's with theirs.
    expect(content!.body).toContain('Vic: My order is late');
    expect(content!.body).toContain('Ada: Let me check on that');
  });

  it("includes the internal note in the team's copy", () => {
    const content = renderTranscript({
      audience: 'team',
      chatId: 'CHAT12345678',
      customerName: 'Vic',
      lines,
    });
    expect(content).not.toBeNull();
    expect(content!.subject).toContain('Vic');
    expect(content!.body).toContain('refund pre-approved');
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
      }),
    ).toBeNull();
    expect(
      renderTranscript({ audience: 'team', chatId: 'C', customerName: null, lines: systemOnly }),
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
    });
    expect(content!.body).toContain('Visitor: (file)');
  });
});
