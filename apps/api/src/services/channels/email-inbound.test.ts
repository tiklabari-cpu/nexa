/**
 * The pure halves of the inbound threading path (tm 358 · SiyahTuş analysis
 * HD-03): which addresses a mail was for, which headers say a machine wrote it,
 * and which ticket a subject tag names. The database half — what a match does
 * to a ticket — is `test/integration/channel-email-threading.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { isAutomatedMail, recipientsOf, ticketIdInSubject } from './email-inbound.js';

const A = '0b6f9a4e-2c1d-4e8f-9a7b-3c5d7e9f1a2b';
const B = '1c7f0b5f-3d2e-4f9a-8b8c-4d6e8f0a2b3c';

describe('recipientsOf', () => {
  it('puts the envelope recipient ahead of To and Cc, and skips strangers', () => {
    const recipients = recipientsOf([
      `${B}@inbound.example`,
      `"Friend, Best" <friend@mail.example>, Support <${A}+support@inbound.example>`,
      `${A}+t-tj1h8cfkrv-8x2k4m6p@inbound.example`,
    ]);
    expect(recipients.map((r) => r.localPart)).toEqual([
      B,
      `${A}+support`,
      `${A}+t-tj1h8cfkrv-8x2k4m6p`,
    ]);
  });

  it('counts an address named twice once, whatever its case', () => {
    expect(recipientsOf([`${A}@inbound.example`, `<${A.toUpperCase()}@Inbound.Example>`])).toEqual([
      { localPart: A, organizationId: A, label: null },
    ]);
  });

  it('finds no workspace in a mail to nobody it knows', () => {
    expect(recipientsOf(['friend@mail.example', 'not-an-org@inbound.example'])).toEqual([]);
  });
});

describe('isAutomatedMail', () => {
  it('reads an auto-reply in each header the loop guard knows (HD-03)', () => {
    for (const headers of [
      { auto_submitted: 'auto-replied' },
      { auto_submitted: 'Auto-Generated; owner-email="x@y"' },
      { x_autoreply: 'yes' },
      { precedence: 'bulk' },
      { precedence: ' Auto_Reply ' },
      { precedence: 'junk' },
      { x_auto_response_suppress: 'All' },
    ]) {
      expect(isAutomatedMail(headers), JSON.stringify(headers)).toBe(true);
    }
  });

  it('takes a person writing for a person (HD-03)', () => {
    for (const headers of [
      {},
      { auto_submitted: 'no' },
      { auto_submitted: ' No ' },
      { x_autoreply: 'no' },
      { precedence: 'list' },
      { auto_submitted: null, precedence: null, x_autoreply: '', x_auto_response_suppress: ' ' },
    ]) {
      expect(isAutomatedMail(headers), JSON.stringify(headers)).toBe(false);
    }
  });
});

describe('ticketIdInSubject', () => {
  it('reads the [#id] a ticket reply leads its subject with, in any case', () => {
    expect(ticketIdInSubject('Re: [#TJ1H8CFKRV] Çekim talebim bekliyor')).toBe('TJ1H8CFKRV');
    expect(ticketIdInSubject('YNT: [#tj1h8cfkrv] Çekim')).toBe('TJ1H8CFKRV');
  });

  it('names no ticket for a tag that is not a ticket id', () => {
    for (const subject of [
      'Re: [#TJ1H8CFKR] short',
      '[#TJ1H8CFKRO] has an O',
      'Order #TJ1H8CFKRV',
    ]) {
      expect(ticketIdInSubject(subject), subject).toBeNull();
    }
  });
});
