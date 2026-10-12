/**
 * The e-mail templates (tm 265): one shared frame, every message in both
 * languages, and the properties that make a message safe to send — text that
 * other people wrote is escaped, only http(s) links are ever made clickable,
 * and the plain-text half carries every link alone on its line.
 */
import { describe, expect, it } from 'vitest';
import { readReceivedMail } from '../../../../test/helpers/received-mail.js';
import { composeMessage } from '../mime.js';
import { escapeHtml, renderEmail, safeUrl, type MailLocale, type RenderedEmail } from './layout.js';
import {
  accountExistsMail,
  customerTranscriptMail,
  duration,
  invitationMail,
  passwordResetMail,
  scheduledReportMail,
  slaBreachMail,
  ssoDomainChallengeMail,
  teamTranscriptMail,
  ticketNoticeMail,
  twoFactorEnabledMail,
  verifyEmailMail,
  visitorMessageMail,
} from './messages.js';

const APP = 'https://panel.siyahkus.com';
const HOSTILE = '<script>alert(1)</script> & "Co"';

/** Every message, rendered with the same facts, in one language. */
function everyMail(locale: MailLocale): Record<string, RenderedEmail> {
  const ctx = { locale, appUrl: APP };
  const messages = [
    {
      role: 'customer' as const,
      who: 'Zeynep',
      text: 'Hello',
      at: new Date('2026-10-11T09:14:00Z'),
    },
    { role: 'agent' as const, who: 'Mehmet', text: 'Hi!', at: new Date('2026-10-11T09:15:00Z') },
  ];
  return {
    verify: verifyEmailMail(ctx, { url: `${APP}/verify-email?token=abc`, hours: 24 }),
    exists: accountExistsMail(ctx, {
      signInUrl: `${APP}/signin`,
      resetUrl: `${APP}/forgot-password`,
    }),
    reset: passwordResetMail(ctx, { url: `${APP}/reset-password?token=abc` }),
    invite: invitationMail(ctx, {
      url: `${APP}/join?token=abc`,
      workspaceName: 'Acme',
      inviterName: 'Ayşe',
      days: 7,
    }),
    twoFactor: twoFactorEnabledMail(ctx, {
      email: 'a@acme.test',
      workspaceName: 'Acme',
      at: new Date('2026-10-11T09:00:00Z'),
      settingsUrl: `${APP}/app/settings/two-factor`,
    }),
    sso: ssoDomainChallengeMail(ctx, { domain: 'acme.test', code: '7f3a9c21', hours: 72 }),
    visitor: visitorMessageMail(ctx, {
      agentName: 'Mehmet',
      workspaceName: 'Acme',
      inboxUrl: `${APP}/app/inbox`,
      settingsUrl: `${APP}/app/settings/notifications`,
    }),
    customerTranscript: customerTranscriptMail(
      { locale },
      {
        workspaceName: 'Acme',
        chatId: 'TJ1H8CFKRV',
        timeZone: 'Europe/Istanbul',
        messages,
      },
    ),
    teamTranscript: teamTranscriptMail(
      { locale },
      {
        workspaceName: 'Acme',
        customerName: 'Zeynep',
        chatId: 'TJ1H8CFKRV',
        timeZone: 'Europe/Istanbul',
        messages,
      },
    ),
    report: scheduledReportMail(ctx, {
      workspaceName: 'Acme',
      reportLabel: 'Chats',
      from: '2026-10-04',
      to: '2026-10-10',
      rowCount: 3,
      filename: 'chats.csv',
    }),
    sla: slaBreachMail(ctx, {
      workspaceName: 'Acme',
      breaches: [
        {
          subjectType: 'thread',
          subjectId: 'abcdef123456',
          target: 'first_response',
          targetMinutes: 5,
          elapsedMinutes: 12,
        },
      ],
      more: 0,
      reportsUrl: `${APP}/app/reports`,
    }),
    ticket: ticketNoticeMail(
      { locale },
      { workspaceName: 'Acme', subject: 'Solved', body: 'Hi,\nIt is solved.' },
    ),
  };
}

describe('every message, in both languages (tm 265)', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`renders all twelve in ${locale}: subject, text and HTML, in that language`, () => {
      const mails = everyMail(locale);
      expect(Object.keys(mails)).toHaveLength(12);
      for (const [name, mail] of Object.entries(mails)) {
        expect(mail.subject, name).toBeTruthy();
        expect(mail.body, name).toBeTruthy();
        expect(mail.locale, name).toBe(locale);
        expect(mail.html, name).toContain(`<html lang="${locale}"`);
        expect(mail.html, name).toContain('SiyahTuş');
        // The hidden inbox snippet is there, and nothing is left unrendered.
        expect(mail.html, name).toContain('display:none;max-height:0');
        expect(mail.html, name).not.toMatch(/\$\{|undefined|\[object Object\]/);
        expect(mail.body, name).not.toMatch(/\$\{|undefined|\[object Object\]/);
      }
    });
  }

  it('says the same thing in Turkish, not the English text', () => {
    const en = everyMail('en');
    const tr = everyMail('tr');
    for (const name of Object.keys(en)) {
      if (name === 'ticket') continue; // the workspace's own words, in whatever language it wrote them
      expect(tr[name]!.subject, name).not.toBe(en[name]!.subject);
    }
    expect(tr['reset']!.subject).toBe('SiyahTuş şifrenizi sıfırlayın');
    expect(tr['reset']!.body).toContain('Yeni şifre belirle');
  });

  it('puts every link alone on its line in the text half, where clients link it', () => {
    for (const mail of Object.values(everyMail('en'))) {
      for (const link of mail.body.match(/https?:\/\/\S+/g) ?? []) {
        const line = mail.body.split('\n').find((l) => l.includes(link))!;
        expect(line.trim()).toBe(link);
      }
    }
    expect(everyMail('en')['reset']!.body).toContain(`\n${APP}/reset-password?token=abc\n`);
  });

  it('keeps the security facts exact', () => {
    const en = everyMail('en');
    expect(en['verify']!.body).toContain('The link expires in 24 hours and works once.');
    expect(en['reset']!.body).toContain('The link expires in one hour and works once.');
    expect(en['invite']!.body).toContain('The invitation expires in 7 days and works once.');
    expect(en['sso']!.body).toContain('7f3a9c21');
    expect(everyMail('tr')['verify']!.body).toContain('Bağlantı 24 saat geçerlidir');
  });

  it('gives a visitor no link to the agent panel', () => {
    for (const name of ['customerTranscript', 'ticket']) {
      const mail = everyMail('en')[name]!;
      expect(mail.html, name).not.toContain(APP);
      expect(mail.body, name).not.toContain(APP);
    }
  });
});

describe('the shared frame', () => {
  it('escapes text other people wrote, everywhere it appears', () => {
    const mail = invitationMail(
      { locale: 'en', appUrl: APP },
      { url: `${APP}/join?token=x`, workspaceName: HOSTILE, inviterName: HOSTILE, days: 7 },
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;');
    // The text half is text: nothing to escape, nothing interpreted.
    expect(mail.body).toContain(HOSTILE);

    const ticket = ticketNoticeMail(
      { locale: 'en' },
      { workspaceName: 'Acme', subject: HOSTILE, body: `${HOSTILE}\nline two` },
    );
    expect(ticket.html).not.toContain('<script>');
    expect(ticket.html).toContain('line two');
  });

  it('never puts a non-http(s) address in an href', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('https://x.test/a?b=1')).toBe('https://x.test/a?b=1');
    const mail = renderEmail({
      locale: 'en',
      homeUrl: 'javascript:alert(1)',
      subject: 's',
      preheader: 'p',
      heading: 'h',
      blocks: [
        { type: 'button', label: 'Go', url: 'javascript:alert(2)', fallback: 'f' },
        { type: 'link', label: 'More', url: 'javascript:alert(3)' },
      ],
      footer: [],
    });
    expect(mail.html).not.toMatch(/href="javascript:/i);
  });

  it('writes durations a person reads at a glance', () => {
    expect(duration('en', 12)).toBe('12 min');
    expect(duration('en', 480)).toBe('8 h');
    expect(duration('tr', 655)).toBe('10 sa 55 dk');
    const sla = everyMail('tr')['sla']!;
    expect(sla.body).toContain('Sohbet · İlk yanıt: 12 dk (hedef 5 dk) · abcdef123456');
  });

  it('escapes the five characters HTML cares about', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('marks an internal note in the team transcript and shows times in the workspace zone', () => {
    const mail = teamTranscriptMail(
      { locale: 'en' },
      {
        workspaceName: 'Acme',
        customerName: 'Zeynep',
        chatId: 'C1',
        timeZone: 'Europe/Istanbul',
        messages: [
          {
            role: 'note',
            who: 'Mehmet · internal note',
            text: 'VIP',
            at: new Date('2026-10-11T09:14:00Z'),
          },
        ],
      },
    );
    expect(mail.body).toContain('[12:14] Mehmet · internal note: VIP');
    expect(mail.html).toContain('st-bubble-note');
  });
});

/** The letter in the header's tile — whose mail this is. */
function markOf(mail: RenderedEmail): string | undefined {
  return mail.html.match(/class="st-mark"[^>]*>([^<]*)<\/td>/)?.[1];
}

describe('the Graphite + Indigo theme (tm 266)', () => {
  it('gives every message the graphite header, and a tile saying what kind of mail it is', () => {
    for (const locale of ['en', 'tr'] as const) {
      for (const [name, mail] of Object.entries(everyMail(locale))) {
        expect(mail.html, name).toContain('class="st-head');
        // The brand indigo, solid under the gradient for clients that drop gradients.
        expect(mail.html, name).toContain('background-color:#5b4fe9');
        // The workspace's own words get no tile of ours; every other mail does.
        if (name === 'ticket') expect(mail.html, name).not.toContain('class="st-tile');
        else expect(mail.html, name).toContain('class="st-tile');
        // Only the missed-SLA alert is tinted red.
        expect(mail.html.includes('class="st-tile st-tile-alert"'), name).toBe(name === 'sla');
      }
    }
  });

  it('keeps the icons out of the text half, which reads exactly as before', () => {
    const mails = everyMail('en');
    // Each message's first line is still its heading — no emoji in front of it.
    expect(mails['verify']!.body.startsWith('Confirm your email address\n')).toBe(true);
    for (const [name, mail] of Object.entries(mails)) {
      expect(mail.body, name).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("heads a workspace's mail to its customers with the workspace, and signs it as the carrier", () => {
    for (const name of ['customerTranscript', 'ticket']) {
      const en = everyMail('en')[name]!;
      expect(markOf(en), name).toBe('A');
      expect(en.html, name).toContain('Sent with SiyahTuş');
      expect(everyMail('tr')[name]!.html, name).toContain('SiyahTuş ile gönderildi');
      expect(en.html, name).not.toContain('>SiyahTuş</td>');
    }
    // The ticket's text half stays exactly the workspace's words; the transcript signs off.
    expect(everyMail('en')['ticket']!.body).toBe('Hi,\nIt is solved.');
    expect(everyMail('en')['customerTranscript']!.body.endsWith('\n\nSent with SiyahTuş')).toBe(
      true,
    );
    // Everyone else's mail is SiyahTuş's own.
    expect(markOf(everyMail('en')['verify']!)).toBe('S');
    expect(markOf(everyMail('en')['teamTranscript']!)).toBe('S');
  });

  it('writes the tile letter by the rules of the reader’s language', () => {
    const tile = (locale: MailLocale, workspaceName: string) =>
      markOf(
        customerTranscriptMail(
          { locale },
          { workspaceName, chatId: 'C1', timeZone: 'UTC', messages: [] },
        ),
      );
    expect(tile('tr', 'istanbul kitap')).toBe('İ');
    expect(tile('tr', 'ırmak')).toBe('I');
    expect(tile('en', 'istanbul kitap')).toBe('I');
    // Escaped like every other name.
    expect(tile('en', '<b>Co')).toBe('&lt;');
  });

  it('sets the "if this was not you" warning of a security notice apart, in the same words', () => {
    const mail = everyMail('en')['twoFactor']!;
    const warning = 'If this was not you, someone else may have access to your account.';
    expect(mail.html).toMatch(new RegExp(`class="st-callout"[^>]*>${warning}`));
    expect(mail.body).toContain(warning);
  });

  it('starts the fine print under an action below a hairline', () => {
    const html = everyMail('en')['reset']!.html;
    const button = html.indexOf('class="st-button"');
    const rule = html.indexOf('class="st-rule"');
    const note = html.indexOf('The link expires in one hour and works once.');
    expect(button).toBeGreaterThan(0);
    expect(rule).toBeGreaterThan(button);
    expect(note).toBeGreaterThan(rule);
  });

  it('follows the reader into dark mode, and pins Outlook to a font it has', () => {
    const html = everyMail('en')['verify']!.html;
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toMatch(/<!--\[if mso\]>[\s\S]*font-family:'Segoe UI'[\s\S]*<!\[endif\]-->/);
  });

  it('puts the visitor on the left and the team on the right of a transcript', () => {
    const html = everyMail('en')['teamTranscript']!.html;
    expect(html).toMatch(/align="left"[^>]*><tr><td class="st-bubble-customer"/);
    expect(html).toMatch(/align="right"[^>]*><tr><td class="st-bubble-agent"/);
  });
});

describe('a templated message on the wire', () => {
  it('arrives as text + HTML, decodes to both halves, and names its language', () => {
    const mail = passwordResetMail(
      { locale: 'tr', appUrl: APP },
      { url: `${APP}/reset-password?token=abc` },
    );
    const raw = composeMessage({
      from: 'no-reply@siyahkus.com',
      to: 'a@b.test',
      subject: mail.subject,
      body: mail.body,
      html: mail.html,
      language: mail.locale,
      date: new Date('2026-10-11T09:00:00Z'),
      messageId: 'm1@siyahkus.com',
    });
    expect(raw).toContain('Content-Type: multipart/alternative; boundary=');
    expect(raw).toContain('Content-Language: tr');
    const received = readReceivedMail(raw);
    expect(received.subject).toBe('SiyahTuş şifrenizi sıfırlayın');
    expect(received.body).toBe(mail.body);
    expect(received.html).toBe(mail.html);
    expect(received.language).toBe('tr');
  });
});
