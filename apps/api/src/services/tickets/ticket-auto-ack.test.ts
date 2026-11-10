import { describe, expect, it } from 'vitest';
import type { TenantClient } from '../../lib/tenant.js';
import {
  TicketAutoAck,
  expectedResponseText,
  messageIdDomainOf,
  senderFailedChecks,
} from './ticket-auto-ack.js';
import type { TicketMessageService } from './ticket-message-service.js';
import { TicketReplyAddresses } from './ticket-reply-address.js';

describe('senderFailedChecks (tm 359 · FR-MOD-13.6 backscatter guard)', () => {
  it('is true only on an explicit SPF or DMARC failure', () => {
    expect(senderFailedChecks({ spf: 'fail' })).toBe(true);
    expect(senderFailedChecks({ spf: 'SoftFail' })).toBe(true);
    expect(senderFailedChecks({ dmarc: ' fail ' })).toBe(true);
    expect(senderFailedChecks({ spf: 'pass', dmarc: 'fail' })).toBe(true);
  });

  it('treats a provider that reported nothing as unknown, not as a failure', () => {
    expect(senderFailedChecks(undefined)).toBe(false);
    expect(senderFailedChecks({})).toBe(false);
    expect(senderFailedChecks({ spf: null, dmarc: null })).toBe(false);
    expect(senderFailedChecks({ spf: 'pass', dmarc: 'pass' })).toBe(false);
    expect(senderFailedChecks({ spf: 'none', dmarc: 'neutral' })).toBe(false);
  });

  it('does not read DKIM: a missing signature alone is not a forged sender', () => {
    expect(senderFailedChecks({ spf: 'pass', dmarc: 'pass' })).toBe(false);
  });
});

describe('messageIdDomainOf', () => {
  it('takes the system address domain, or a reserved name without one', () => {
    expect(messageIdDomainOf({ SMTP_FROM: 'noreply@mail.example.com' })).toBe('mail.example.com');
    expect(messageIdDomainOf({ SMTP_FROM: undefined })).toBe('siyahtus.invalid');
  });
});

describe('expectedResponseText', () => {
  it('promises nothing until the first-response target exists (HD-05)', () => {
    expect(expectedResponseText()).toBeNull();
  });
});

describe('TicketAutoAck.prepare (stubbed transaction)', () => {
  const tenant = { licenseId: 1n, organizationId: 'org-1' };
  const template = { id: 't1', name: 'Alındı', subject: 'Aldık', body: 'Merhaba', enabled: true };

  function harness(
    ticket: { customer: { name: string; email: string | null; locale?: string | null } | null },
    workspace: { language: string; fallbackLanguage: string } | null = null,
  ) {
    const notes: string[] = [];
    const tx = {
      ticket: {
        findUnique: async () => ({
          id: 'TCK1',
          subject: 'Konu',
          priority: 0,
          status: 'open',
          mergedIntoId: null,
          ...ticket,
        }),
      },
      ticketEmailTemplate: { findFirst: async () => template },
      organization: { findUnique: async () => ({ name: 'Acme' }) },
      brand: { findFirst: async () => (workspace ? { id: 'brand-1' } : null) },
      widgetSettings: { findFirst: async () => workspace },
    } as unknown as TenantClient;
    const messages = {
      recordSystemNote: async (_tx: unknown, _tenant: unknown, _id: string, text: string) => {
        notes.push(text);
        return 'm1';
      },
    } as unknown as TicketMessageService;
    const ack = new TicketAutoAck(messages, {
      outbound: true,
      messageIdDomain: 'mail.example.com',
      replyAddresses: new TicketReplyAddresses('s'.repeat(32), 'inbound.example.com'),
      pilotMode: false,
    });
    return { notes, tx, ack };
  }

  it('writes “no recipient” and sends nothing for a ticket without an address (FR-MOD-13.6)', async () => {
    const { notes, tx, ack } = harness({ customer: { name: 'Ayşe', email: null } });
    const mail = await ack.prepare(tx, tenant, {
      ticketId: 'TCK1',
      ack: { templateId: 't1', ruleName: 'r' },
    });
    expect(mail).toBeNull();
    expect(notes).toEqual(['Automatic acknowledgement not sent: no recipient address.']);
  });

  it('answers the player’s mail and signs its reply address (FR-MOD-13.6)', async () => {
    const { notes, tx, ack } = harness({ customer: { name: 'Ayşe', email: 'a@example.test' } });
    const mail = await ack.prepare(tx, tenant, {
      ticketId: 'TCK1',
      ack: { templateId: 't1', ruleName: 'r' },
      thread: { messageId: 'p@x.test', references: ['o@x.test'] },
    });
    expect(mail).toMatchObject({
      to: 'a@example.test',
      subject: '[#TCK1] Aldık',
      inReplyTo: 'p@x.test',
      references: ['o@x.test', 'p@x.test'],
    });
    expect(mail!.replyTo).toMatch(/^org-1\+t-tck1-[a-z0-9]+@inbound\.example\.com$/);
    expect(mail!.emailMessageId).toMatch(/@mail\.example\.com$/);
    expect(notes).toEqual(['Automatic acknowledgement sent: Alındı']);
  });

  // tm 462 · F48: the frame's language is the player's, else the workspace's, else English.
  describe('the language of the acknowledgement (tm 462)', () => {
    const localeOf = async (
      customerLocale: string | null,
      workspace: { language: string; fallbackLanguage: string } | null,
    ) => {
      const { tx, ack } = harness(
        { customer: { name: 'Ayşe', email: 'a@example.test', locale: customerLocale } },
        workspace,
      );
      const mail = await ack.prepare(tx, tenant, {
        ticketId: 'TCK1',
        ack: { templateId: 't1', ruleName: 'r' },
      });
      return mail!.locale;
    };

    it('takes the player’s own language when the templates are written in it', async () => {
      expect(await localeOf('tr', null)).toBe('tr');
      expect(await localeOf('en', { language: 'tr', fallbackLanguage: 'tr' })).toBe('en');
    });

    it('falls back to the workspace’s language only for a player with none on file', async () => {
      expect(await localeOf(null, { language: 'tr', fallbackLanguage: 'en' })).toBe('tr');
      expect(await localeOf(null, { language: 'auto', fallbackLanguage: 'tr' })).toBe('tr');
    });

    it('answers English for an unsupported language, the workspace’s included', async () => {
      expect(await localeOf('de', { language: 'tr', fallbackLanguage: 'tr' })).toBe('en');
      expect(await localeOf(null, { language: 'de', fallbackLanguage: 'de' })).toBe('en');
      expect(await localeOf(null, null)).toBe('en');
    });
  });
});
