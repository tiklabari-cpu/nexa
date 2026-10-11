/**
 * Every e-mail SiyahTuş sends, rendered by the real templates, on one page
 * (tm 265): `pnpm --filter @siyahtus/api mail:preview` writes
 * `docs/eposta-onizleme.html`.
 *
 * The page is generated, never hand-written, so it cannot drift from what is
 * sent: each message is the output of the same function the route calls, fed
 * sample facts. Each one is shown as an inbox would show it — the HTML in a
 * frame of its own, the plain-text half beneath — in English and Turkish.
 * Nothing here sends anything.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  escapeHtml,
  type MailLocale,
  type RenderedEmail,
} from '../src/services/mail/templates/layout.js';
import {
  accountExistsMail,
  customerTranscriptMail,
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
} from '../src/services/mail/templates/messages.js';

const APP = 'https://panel.siyahkus.com';
const TOKEN = 'Zx8kQ2rTn4vB7mL1pW9sYc3dHf6gJa0uE5oRiKtN';

interface Sample {
  id: string;
  title: Record<MailLocale, string>;
  when: Record<MailLocale, string>;
  to: string;
  /** A file the message carries, shown in the card's header. */
  attachment?: string;
  render: (locale: MailLocale) => RenderedEmail;
}

const at = (hhmm: string) => new Date(`2026-10-11T${hhmm}:00Z`);
const conversation = (locale: MailLocale) => [
  {
    role: 'customer' as const,
    who: 'Zeynep',
    at: at('06:14'),
    text:
      locale === 'tr' ? 'Merhaba, siparişim henüz gelmedi.' : "Hello, my order hasn't arrived yet.",
  },
  {
    role: 'agent' as const,
    who: 'Mehmet',
    at: at('06:14'),
    text:
      locale === 'tr'
        ? 'Merhaba Zeynep, hemen kontrol ediyorum.'
        : 'Hi Zeynep, let me check that for you.',
  },
  {
    role: 'note' as const,
    who: locale === 'tr' ? 'Mehmet · dahili not' : 'Mehmet · internal note',
    at: at('06:15'),
    text: locale === 'tr' ? 'Depoda gecikme var, talep #42.' : 'Warehouse delay, see ticket #42.',
  },
  {
    role: 'agent' as const,
    who: 'Mehmet',
    at: at('06:16'),
    text:
      locale === 'tr'
        ? 'Bugün kargoya veriliyor; takip numarası e-postayla gelecek.'
        : "It ships today; you'll get a tracking number by email.",
  },
  {
    role: 'customer' as const,
    who: 'Zeynep',
    at: at('06:16'),
    text: locale === 'tr' ? 'Teşekkürler!' : 'Thank you!',
  },
  {
    role: 'system' as const,
    who: '',
    at: at('06:18'),
    text: locale === 'tr' ? 'Sohbet arşivlendi' : 'Chat archived',
  },
];

const SAMPLES: Sample[] = [
  {
    id: 'verify',
    title: { en: 'Confirm email address', tr: 'Kayıt doğrulama' },
    when: {
      en: 'Sign-up, when verification is on, and "resend"',
      tr: 'Kayıtta (doğrulama açıksa) ve "yeniden gönder"de',
    },
    to: 'ayse@acme.example',
    render: (locale) =>
      verifyEmailMail(
        { locale, appUrl: APP },
        { url: `${APP}/verify-email?token=${TOKEN}`, hours: 24 },
      ),
  },
  {
    id: 'exists',
    title: { en: 'Account already exists', tr: 'Hesap zaten var' },
    when: {
      en: 'A sign-up with an address that has an account',
      tr: 'Kayıtlı bir adresle yeniden kayıt denenince',
    },
    to: 'ayse@acme.example',
    render: (locale) =>
      accountExistsMail(
        { locale, appUrl: APP },
        { signInUrl: `${APP}/signin`, resetUrl: `${APP}/forgot-password` },
      ),
  },
  {
    id: 'reset',
    title: { en: 'Password reset', tr: 'Şifre sıfırlama' },
    when: { en: '"Forgot password"', tr: '"Şifremi unuttum"' },
    to: 'ayse@acme.example',
    render: (locale) =>
      passwordResetMail({ locale, appUrl: APP }, { url: `${APP}/reset-password?token=${TOKEN}` }),
  },
  {
    id: 'invite',
    title: { en: 'Team invitation', tr: 'Ekibe davet' },
    when: { en: 'An admin invites a teammate', tr: 'Bir yönetici ekip arkadaşı davet edince' },
    to: 'mehmet@acme.example',
    render: (locale) =>
      invitationMail(
        { locale, appUrl: APP },
        {
          url: `${APP}/join?token=${TOKEN}`,
          workspaceName: 'Acme',
          inviterName: 'Ayşe Demir',
          days: 7,
        },
      ),
  },
  {
    id: '2fa',
    title: { en: 'Two-factor turned on', tr: 'İki adımlı doğrulama açıldı' },
    when: { en: 'Security notice when 2FA is enabled', tr: '2FA açılınca güvenlik bildirimi' },
    to: 'ayse@acme.example',
    render: (locale) =>
      twoFactorEnabledMail(
        { locale, appUrl: APP },
        {
          email: 'ayse@acme.example',
          workspaceName: 'Acme',
          at: new Date('2026-10-11T09:42:00Z'),
          settingsUrl: `${APP}/app/settings/two-factor`,
        },
      ),
  },
  {
    id: 'sso',
    title: { en: 'SSO domain verification', tr: 'SSO alan adı doğrulama' },
    when: {
      en: 'Proving a domain for single sign-on',
      tr: 'Tek oturum açma için alan adı doğrulanırken',
    },
    to: 'postmaster@acme.example',
    render: (locale) =>
      ssoDomainChallengeMail(
        { locale, appUrl: APP },
        { domain: 'acme.example', code: '7F3A-9C21', hours: 72 },
      ),
  },
  {
    id: 'visitor',
    title: { en: 'New visitor message', tr: 'Yeni ziyaretçi mesajı' },
    when: {
      en: 'A visitor writes in a chat assigned to you',
      tr: 'Size atanmış sohbete ziyaretçi yazınca',
    },
    to: 'mehmet@acme.example',
    render: (locale) =>
      visitorMessageMail(
        { locale, appUrl: APP },
        {
          agentName: 'Mehmet',
          workspaceName: 'Acme',
          inboxUrl: `${APP}/app/inbox`,
          settingsUrl: `${APP}/app/settings/notifications`,
        },
      ),
  },
  {
    id: 'transcript-customer',
    title: { en: 'Chat transcript (visitor)', tr: 'Sohbet dökümü (ziyaretçi)' },
    when: {
      en: 'A chat ends — the visitor’s copy, internal notes left out',
      tr: 'Sohbet bitince ziyaretçinin kopyası (dahili notlar hariç)',
    },
    to: 'zeynep@gmail.example',
    render: (locale) =>
      customerTranscriptMail(
        { locale },
        {
          workspaceName: 'Acme',
          chatId: 'TJ1H8CFKRV',
          timeZone: 'Europe/Istanbul',
          messages: conversation(locale).filter((m) => m.role !== 'note'),
        },
      ),
  },
  {
    id: 'transcript-team',
    title: { en: 'Chat transcript (team)', tr: 'Sohbet dökümü (ekip)' },
    when: {
      en: 'A chat ends — the assignee’s copy, notes marked',
      tr: 'Sohbet bitince atanmış ajanın kopyası (notlar işaretli)',
    },
    to: 'mehmet@acme.example',
    render: (locale) =>
      teamTranscriptMail(
        { locale },
        {
          workspaceName: 'Acme',
          customerName: 'Zeynep',
          chatId: 'TJ1H8CFKRV',
          timeZone: 'Europe/Istanbul',
          messages: conversation(locale),
        },
      ),
  },
  {
    id: 'report',
    title: { en: 'Scheduled report (CSV attached)', tr: 'Planlı rapor (CSV ekli)' },
    when: {
      en: 'Daily, weekly or monthly, to the report’s recipients',
      tr: 'Günlük/haftalık/aylık, raporun alıcılarına',
    },
    to: 'ayse@acme.example',
    attachment: 'siyahtus-chats-2026-10-04-2026-10-10.csv (text/csv)',
    render: (locale) =>
      scheduledReportMail(
        { locale, appUrl: APP },
        {
          workspaceName: 'Acme',
          reportLabel: locale === 'tr' ? 'Sohbetler' : 'Chats',
          from: '2026-10-04',
          to: '2026-10-10',
          rowCount: 7,
          filename: 'siyahtus-chats-2026-10-04-2026-10-10.csv',
        },
      ),
  },
  {
    id: 'sla',
    title: { en: 'SLA targets missed', tr: 'SLA hedefleri kaçırıldı' },
    when: {
      en: 'To the owner, when a target is missed',
      tr: 'Bir hedef kaçırılınca çalışma alanı sahibine',
    },
    to: 'ayse@acme.example',
    render: (locale) =>
      slaBreachMail(
        { locale, appUrl: APP },
        {
          workspaceName: 'Acme',
          breaches: [
            {
              subjectType: 'thread',
              subjectId: '0b8c1e3a-1111-4222-8333-944455556666',
              target: 'first_response',
              targetMinutes: 5,
              elapsedMinutes: 12,
            },
            {
              subjectType: 'ticket',
              subjectId: '7d2f9a10-2222-4333-8444-a55566667777',
              target: 'resolution',
              targetMinutes: 480,
              elapsedMinutes: 655,
            },
          ],
          more: 0,
          reportsUrl: `${APP}/app/reports`,
        },
      ),
  },
  {
    id: 'ticket',
    title: {
      en: 'Ticket update (workspace’s own text)',
      tr: 'Talep bildirimi (çalışma alanının metni)',
    },
    when: {
      en: 'A ticket changes status; the workspace writes the text',
      tr: 'Talep durumu değişince; metni çalışma alanı yazar',
    },
    to: 'zeynep@gmail.example',
    render: (locale) =>
      ticketNoticeMail(
        { locale },
        {
          workspaceName: 'Acme',
          subject:
            locale === 'tr'
              ? '"Sipariş gelmedi" talebiniz çözüldü'
              : 'Your request "Order not arrived" is solved',
          body:
            locale === 'tr'
              ? 'Merhaba Zeynep,\n\n"Sipariş gelmedi" talebiniz çözüldü. Eksik bir şey kaldıysa bize yazmanız yeterli.\n\nAcme Destek Ekibi'
              : 'Hi Zeynep,\n\nYour request "Order not arrived" is now solved. If anything is still missing, just let us know.\n\nThe Acme Support Team',
        },
      ),
  },
];

function card(sample: Sample, locale: MailLocale): string {
  const mail = sample.render(locale);
  const id = `${sample.id}-${locale}`;
  return `<article class="mail" id="${id}" data-locale="${locale}">
  <header>
    <h2>${escapeHtml(sample.title[locale])}</h2>
    <p class="when">${escapeHtml(sample.when[locale])}</p>
    <dl>
      <dt>${locale === 'tr' ? 'Konu' : 'Subject'}</dt><dd><strong>${escapeHtml(mail.subject)}</strong></dd>
      <dt>${locale === 'tr' ? 'Kime' : 'To'}</dt><dd>${escapeHtml(sample.to)}</dd>
      ${sample.attachment ? `<dt>${locale === 'tr' ? 'Ek' : 'File'}</dt><dd>📎 ${escapeHtml(sample.attachment)}</dd>` : ''}
    </dl>
  </header>
  <iframe title="${escapeHtml(mail.subject)}" srcdoc="${escapeHtml(mail.html)}"></iframe>
  <details><summary>${locale === 'tr' ? 'Düz metin hali' : 'Plain-text version'}</summary><pre>${escapeHtml(mail.body)}</pre></details>
</article>`;
}

function page(): string {
  const nav = SAMPLES.map(
    (s) =>
      `<a href="#${s.id}-tr" data-for="tr">${escapeHtml(s.title.tr)}</a><a href="#${s.id}-en" data-for="en">${escapeHtml(s.title.en)}</a>`,
  ).join('');
  const cards = SAMPLES.flatMap((s) => [card(s, 'tr'), card(s, 'en')]).join('\n');
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiyahTuş e-postaları</title>
<style>
  :root { --bg:#eceef1; --card:#fff; --ink:#111318; --muted:#5d6573; --line:#dde1e7; --accent:#111318; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#121418; --card:#1c1f25; --ink:#eef0f3; --muted:#9aa2b1; --line:#2f343d; --accent:#eef0f3; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:24px 16px 80px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .lead { color:var(--muted); margin:0 0 16px; }
  .switch { display:inline-flex; border:1px solid var(--line); border-radius:999px; overflow:hidden; margin-bottom:16px; }
  .switch button { border:0; background:transparent; color:var(--ink); padding:6px 16px; font:inherit; cursor:pointer; }
  .switch button[aria-pressed="true"] { background:var(--accent); color:var(--bg); }
  nav { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:24px; }
  nav a { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:13px; color:var(--ink); text-decoration:none; }
  .mail { background:var(--card); border:1px solid var(--line); border-radius:12px; margin-bottom:24px; overflow:hidden; }
  .mail header { padding:14px 18px; border-bottom:1px solid var(--line); }
  .mail h2 { font-size:16px; margin:0; }
  .when { margin:2px 0 8px; color:var(--muted); font-size:13px; }
  dl { display:grid; grid-template-columns:64px 1fr; gap:2px 8px; margin:0; font-size:13px; }
  dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
  iframe { display:block; width:100%; height:720px; border:0; background:#f2f3f5; }
  [data-locale] iframe { min-height:200px; }
  details { border-top:1px solid var(--line); padding:10px 18px; }
  summary { cursor:pointer; color:var(--muted); font-size:13px; }
  pre { white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.5 ui-monospace,Consolas,monospace; margin:10px 0 0; }
  body[data-show="tr"] [data-locale="en"], body[data-show="tr"] [data-for="en"],
  body[data-show="en"] [data-locale="tr"], body[data-show="en"] [data-for="tr"] { display:none; }
</style>
</head>
<body data-show="tr">
<div class="wrap">
  <h1>SiyahTuş e-postaları</h1>
  <p class="lead">Gerçek şablonlardan üretildi (<code>pnpm --filter @siyahtus/api mail:preview</code>). Her e-posta HTML ve düz metin olarak birlikte gider; e-posta programı HTML'i gösteremezse düz metni gösterir. Bağlantılar, kodlar ve isimler örnektir.</p>
  <div class="switch" role="group" aria-label="Dil / Language">
    <button type="button" data-lang="tr" aria-pressed="true">Türkçe</button>
    <button type="button" data-lang="en" aria-pressed="false">English</button>
  </div>
  <nav>${nav}</nav>
  ${cards}
</div>
<script>
  // Each frame as tall as the message in it, so nothing scrolls inside a card.
  const fit = (frame) => {
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.body || frame.offsetParent === null) return;
      // Shrink first: a document is never shorter than the frame showing it.
      frame.style.height = '1px';
      frame.style.height = doc.documentElement.scrollHeight + 'px';
    } catch (_) {}
  };
  for (const frame of document.querySelectorAll('iframe')) {
    frame.addEventListener('load', () => fit(frame));
    fit(frame);
  }
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', () => {
      document.body.dataset.show = button.dataset.lang;
      // A frame measured while hidden measured nothing.
      for (const frame of document.querySelectorAll('iframe')) fit(frame);
      for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b === button));
    });
  }
</script>
</body>
</html>
`;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../docs/eposta-onizleme.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page(), 'utf8');
process.stdout.write(`wrote ${out} (${SAMPLES.length} messages × 2 languages)\n`);
