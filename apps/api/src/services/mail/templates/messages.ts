/**
 * Every e-mail SiyahTuş writes, in English and Turkish (tm 265).
 *
 * One function per message: it takes the facts (a link, a name, a code) and
 * the reader's language, and returns the subject plus both bodies, rendered by
 * the shared layout (`layout.ts`). The send sites only choose the language and
 * hand over the facts — no prose is written anywhere else, so what a person
 * receives is reviewed here, in one place, in both languages.
 *
 * House rules for the copy:
 *
 * - The subject says what happened; the preheader says what to do.
 * - One clear action per message, as a button — and the same link as text
 *   under it, because people (rightly) hesitate to click buttons in mail.
 * - Every message that could arrive unasked says what to do if it was not you.
 * - Security facts stay exact: how long a link lives, that it works once.
 * - The plain-text body keeps every link alone on its line, so a client links
 *   it and nothing trails into the URL.
 */
import {
  renderEmail,
  type EmailBlock,
  type MailLocale,
  type RenderedEmail,
  type TranscriptEntry,
  type TranscriptRole,
} from './layout.js';

export type { MailLocale, RenderedEmail } from './layout.js';

/** What every message needs besides its own facts. */
export interface MailContext {
  locale: MailLocale;
  /**
   * The panel's address (`WEB_APP_URL`) — linked from the mark and named in
   * the footer. Omitted for mail to a customer: the agent panel is nothing a
   * visitor can use, so their copy carries no link to it.
   */
  appUrl?: string;
}

const tr = (locale: MailLocale): boolean => locale === 'tr';

function host(appUrl: string): string | null {
  try {
    return new URL(appUrl).host;
  } catch {
    return null;
  }
}

function signature(ctx: MailContext): string {
  const where = ctx.appUrl ? host(ctx.appUrl) : null;
  return where ? `SiyahTuş · ${where}` : 'SiyahTuş';
}

/**
 * The signature on mail a workspace sends its own customers: the workspace
 * heads it, and we are only the carrier.
 */
function poweredBy(locale: MailLocale): string {
  return tr(locale) ? 'SiyahTuş ile gönderildi' : 'Sent with SiyahTuş';
}

/**
 * The tile above each heading — one per kind of mail, so a reader tells a
 * security notice from a report before reading a word. Written as escapes:
 * the source stays ASCII, and each is a code point that renders in colour
 * without a variation selector.
 */
const ICON = {
  verify: '\u{1F4E9}', // envelope with arrow
  account: '\u{1F464}', // bust in silhouette
  key: '\u{1F511}', // key
  wave: '\u{1F44B}', // waving hand
  lock: '\u{1F510}', // closed lock with key
  globe: '\u{1F310}', // globe with meridians
  speech: '\u{1F4AC}', // speech balloon
  receipt: '\u{1F9FE}', // receipt
  clipboard: '\u{1F4CB}', // clipboard
  chart: '\u{1F4CA}', // bar chart
  alarm: '\u{23F0}', // alarm clock
} as const;

function fallback(ctx: MailContext): string {
  return tr(ctx.locale)
    ? 'Düğme çalışmazsa bu bağlantıyı tarayıcınıza yapıştırın:'
    : 'If the button does not work, paste this link into your browser:';
}

function hoursText(locale: MailLocale, hours: number): string {
  if (tr(locale)) return `${hours} saat`;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function daysText(locale: MailLocale, days: number): string {
  if (tr(locale)) return `${days} gün`;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// --- Account mail ---------------------------------------------------------------

export function verifyEmailMail(
  ctx: MailContext,
  input: { url: string; hours: number },
): RenderedEmail {
  const t = tr(ctx.locale);
  const ttl = hoursText(ctx.locale, input.hours);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    subject: t
      ? 'SiyahTuş için e-posta adresinizi doğrulayın'
      : 'Confirm your email address for SiyahTuş',
    preheader: t
      ? 'Çalışma alanınızın kurulumunu tamamlamak için tek bir adım kaldı.'
      : 'One step left to finish setting up your workspace.',
    icon: ICON.verify,
    heading: t ? 'E-posta adresinizi doğrulayın' : 'Confirm your email address',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? "SiyahTuş'a kaydolduğunuz için teşekkürler. Çalışma alanınızın kurulumunu tamamlamak için bu adresin size ait olduğunu doğrulayın."
          : 'Thanks for signing up for SiyahTuş. Confirm that this address is yours to finish setting up your workspace.',
      },
      {
        type: 'button',
        label: t ? 'E-posta adresimi doğrula' : 'Confirm email address',
        url: input.url,
        fallback: fallback(ctx),
      },
      {
        type: 'note',
        text: t
          ? `Kayıt olurken belirlediğiniz şifre sorulacak. Bağlantı ${ttl} geçerlidir ve yalnızca bir kez kullanılabilir.`
          : `You will be asked for the password you chose when you signed up. The link expires in ${ttl} and works once.`,
      },
      {
        type: 'note',
        text: t
          ? 'Kaydolan siz değilseniz bu e-postayı yok sayabilirsiniz. Şifre olmadan bağlantı hiçbir işe yaramaz.'
          : 'If you did not sign up, you can ignore this email. Without the password, the link does nothing.',
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, bu adresle bir SiyahTuş hesabı açıldığı için aldınız.'
        : 'You received this email because this address was used to create a SiyahTuş account.',
      signature(ctx),
    ],
  });
}

/**
 * The verification link an invitee gets after accepting (tm 282 · GV-03): the
 * invitation link is also handed to the admin, so it proves nobody owns the
 * address — this mail does. Its own copy because the sign-up one thanks the
 * reader for opening a workspace they never opened.
 */
export function joinVerifyEmailMail(
  ctx: MailContext,
  input: { url: string; hours: number; workspaceName: string },
): RenderedEmail {
  const t = tr(ctx.locale);
  const ws = input.workspaceName;
  const ttl = hoursText(ctx.locale, input.hours);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: ws,
    subject: t
      ? `${ws} ekibine katılmak için e-posta adresinizi doğrulayın`
      : `Confirm your email address to join ${ws}`,
    preheader: t ? 'Ekibe katılmak için tek bir adım kaldı.' : 'One step left to join the team.',
    icon: ICON.verify,
    heading: t ? 'E-posta adresinizi doğrulayın' : 'Confirm your email address',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `SiyahTuş'taki ${ws} ekibine katılma davetini kabul ettiniz. Katılımınız, bu adresin size ait olduğunu doğruladığınızda tamamlanır.`
          : `You accepted an invitation to join the ${ws} team on SiyahTuş. You join once you confirm that this address is yours.`,
      },
      {
        type: 'button',
        label: t ? 'E-posta adresimi doğrula' : 'Confirm email address',
        url: input.url,
        fallback: fallback(ctx),
      },
      {
        type: 'note',
        text: t
          ? `Daveti kabul ederken belirlediğiniz şifre sorulacak. Bağlantı ${ttl} geçerlidir ve yalnızca bir kez kullanılabilir.`
          : `You will be asked for the password you chose when you accepted the invitation. The link expires in ${ttl} and works once.`,
      },
      {
        type: 'note',
        text: t
          ? 'Daveti kabul eden siz değilseniz bu e-postayı yok sayabilirsiniz. Şifre olmadan bağlantı hiçbir işe yaramaz ve bu adresle kimse ekibe katılamaz.'
          : 'If you did not accept this invitation, you can ignore this email. Without the password, the link does nothing, and nobody joins the team with this address.',
      },
    ],
    footer: [
      t
        ? `Bu e-postayı, bu adres için ${ws} ekibine katılma daveti kabul edildiği için aldınız.`
        : `You received this email because an invitation to join ${ws} was accepted for this address.`,
      signature(ctx),
    ],
  });
}

export function accountExistsMail(
  ctx: MailContext,
  input: { signInUrl: string; resetUrl: string },
): RenderedEmail {
  const t = tr(ctx.locale);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    subject: t ? 'Zaten bir SiyahTuş hesabınız var' : 'You already have a SiyahTuş account',
    preheader: t
      ? 'Bu adresle yeniden kayıt denendi; yeni bir şey oluşturulmadı.'
      : 'Someone tried to sign up with this address again. Nothing new was created.',
    icon: ICON.account,
    heading: t ? 'Zaten bir hesabınız var' : 'You already have an account',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? 'Birisi (belki siz) az önce bu adresle yeni bir SiyahTuş çalışma alanı açmayı denedi. Bu adresin zaten bir hesabı olduğu için yeni bir şey oluşturulmadı.'
          : 'Someone (perhaps you) just tried to create a SiyahTuş workspace with this address. The address already has an account, so nothing new was created.',
      },
      {
        type: 'button',
        label: t ? 'Giriş yap' : 'Sign in',
        url: input.signInUrl,
        fallback: fallback(ctx),
      },
      {
        type: 'link',
        label: t
          ? 'Şifrenizi mi unuttunuz? Buradan sıfırlayın'
          : 'Forgot your password? Reset it here',
        url: input.resetUrl,
      },
      {
        type: 'note',
        text: t
          ? 'Bu siz değilseniz bir şey yapmanıza gerek yok; hesabınızda hiçbir şey değişmedi.'
          : 'If this was not you, there is nothing to do: nothing about your account has changed.',
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, adresinizle bir kayıt denendiği için aldınız.'
        : 'You received this email because someone tried to sign up with your address.',
      signature(ctx),
    ],
  });
}

export function passwordResetMail(ctx: MailContext, input: { url: string }): RenderedEmail {
  const t = tr(ctx.locale);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    subject: t ? 'SiyahTuş şifrenizi sıfırlayın' : 'Reset your SiyahTuş password',
    preheader: t
      ? 'Bağlantı bir saat geçerli ve yalnızca bir kez kullanılabilir.'
      : 'The link works once and expires in one hour.',
    icon: ICON.key,
    heading: t ? 'Şifrenizi sıfırlayın' : 'Reset your password',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? 'SiyahTuş hesabınızın şifresini sıfırlamak için bir istek aldık. Aşağıdaki düğmeyle yeni bir şifre belirleyebilirsiniz.'
          : 'We received a request to reset the password for your SiyahTuş account. Use the button below to choose a new one.',
      },
      {
        type: 'button',
        label: t ? 'Yeni şifre belirle' : 'Choose a new password',
        url: input.url,
        fallback: fallback(ctx),
      },
      {
        type: 'note',
        text: t
          ? 'Bağlantı bir saat geçerlidir ve yalnızca bir kez kullanılabilir.'
          : 'The link expires in one hour and works once.',
      },
      {
        type: 'note',
        text: t
          ? 'Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.'
          : 'If you did not ask for this, ignore this email: your password stays the same.',
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, bu adres için şifre sıfırlama istendiği için aldınız.'
        : 'You received this email because a password reset was requested for this address.',
      signature(ctx),
    ],
  });
}

export function invitationMail(
  ctx: MailContext,
  input: { url: string; workspaceName: string; inviterName: string | null; days: number },
): RenderedEmail {
  const t = tr(ctx.locale);
  const ws = input.workspaceName;
  const who = input.inviterName?.trim() || null;
  const ttl = daysText(ctx.locale, input.days);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: ws,
    subject: t
      ? who
        ? `${who} sizi SiyahTuş'ta ${ws} ekibine davet etti`
        : `SiyahTuş'ta ${ws} ekibine davet edildiniz`
      : who
        ? `${who} invited you to join ${ws} on SiyahTuş`
        : `You have been invited to join ${ws} on SiyahTuş`,
    preheader: t
      ? 'Ekibe katılın ve müşteri sohbetlerini birlikte yanıtlamaya başlayın.'
      : 'Join the team and start answering customer conversations together.',
    icon: ICON.wave,
    heading: t ? `${ws} ekibine katılın` : `Join ${ws}`,
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `${who ?? 'Bir ekip yöneticisi'}, sizi SiyahTuş'taki ${ws} ekibine davet etti. Ekibe katıldığınızda müşteri sohbetlerini ve taleplerini birlikte yanıtlayabileceksiniz.`
          : `${who ?? 'A team admin'} has invited you to join the ${ws} team on SiyahTuş, where you will answer customer chats and tickets together.`,
      },
      {
        type: 'button',
        label: t ? 'Daveti kabul et' : 'Accept invitation',
        url: input.url,
        fallback: fallback(ctx),
      },
      {
        type: 'note',
        text: t
          ? `Davet ${ttl} geçerlidir ve yalnızca bir kez kullanılabilir. Beklemediğiniz bir davetse bu e-postayı yok sayabilirsiniz.`
          : `The invitation expires in ${ttl} and works once. If you were not expecting it, you can ignore this email.`,
      },
    ],
    footer: [
      t
        ? `Bu e-postayı, ${ws} çalışma alanından biri sizi davet ettiği için aldınız.`
        : `You received this email because someone at ${ws} invited you.`,
      signature(ctx),
    ],
  });
}

export function twoFactorEnabledMail(
  ctx: MailContext,
  input: { email: string; workspaceName: string; at: Date; settingsUrl: string },
): RenderedEmail {
  const t = tr(ctx.locale);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    subject: t
      ? 'SiyahTuş hesabınızda iki adımlı doğrulama açıldı'
      : 'Two-factor authentication is now on for your SiyahTuş account',
    preheader: t
      ? 'Hesabınızda bir güvenlik değişikliği oldu; sizin yaptığınızdan emin olun.'
      : 'A security setting on your account changed. Make sure it was you.',
    icon: ICON.lock,
    heading: t ? 'İki adımlı doğrulama açıldı' : 'Two-factor authentication is on',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? 'Hesabınızda iki adımlı doğrulama az önce açıldı. Bundan sonra bu hesapla hangi çalışma alanına girerseniz girin, şifrenizin yanında doğrulama uygulamanızdaki kod da istenecek.'
          : 'Two-factor authentication was just turned on for your account. From now on, signing in to any workspace with this account also needs a code from your authenticator app.',
      },
      {
        type: 'facts',
        rows: [
          [t ? 'Hesap' : 'Account', input.email],
          [t ? 'Çalışma alanı' : 'Workspace', input.workspaceName],
          [t ? 'Zaman' : 'When', formatDateTime(input.at, ctx.locale, 'UTC')],
        ],
      },
      {
        type: 'paragraph',
        text: t
          ? 'Bunu siz yaptıysanız kurtarma kodlarınızı güvenli bir yerde saklayın. Telefonunuzu kaybederseniz hesabınıza onlarla girersiniz.'
          : 'If this was you, keep your recovery codes somewhere safe. They are your way back in if you lose your phone.',
      },
      {
        type: 'callout',
        text: t
          ? 'Bunu siz yapmadıysanız hesabınıza başkası erişmiş olabilir. Hemen giriş yapın, Hesap ayarlarından iki adımlı doğrulamayı kapatıp şifrenizi değiştirin ve çalışma alanının bir sahibine haber verin.'
          : 'If this was not you, someone else may have access to your account. Sign in now, turn two-factor authentication off in your account settings, change your password, and tell an owner of the workspace.',
      },
      {
        type: 'button',
        label: t ? 'Güvenlik ayarlarını aç' : 'Open security settings',
        url: input.settingsUrl,
        fallback: fallback(ctx),
      },
    ],
    footer: [
      t
        ? 'Bu, hesabınızın güvenliği için gönderilen bir bildirimdir ve kapatılamaz.'
        : 'This is a security notice about your account and cannot be turned off.',
      signature(ctx),
    ],
  });
}

// --- Workspace mail ---------------------------------------------------------------

export function ssoDomainChallengeMail(
  ctx: MailContext,
  input: { domain: string; code: string; hours: number },
): RenderedEmail {
  const t = tr(ctx.locale);
  const d = input.domain;
  const ttl = hoursText(ctx.locale, input.hours);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    subject: t ? `${d} için tek oturum açma doğrulaması` : `Verify ${d} for single sign-on`,
    preheader: t
      ? `${d} alan adının size ait olduğunu doğrulamak için bir kod.`
      : `A code to confirm that ${d} belongs to you.`,
    icon: ICON.globe,
    heading: t ? `${d} alan adını doğrulayın` : `Confirm you manage ${d}`,
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `Birisi SiyahTuş'ta ${d} için tek oturum açma (SSO) kuruyor ve alan adının kendisine ait olduğunu doğrulaması gerekiyor.`
          : `Someone is setting up single sign-on (SSO) for ${d} in SiyahTuş and needs to confirm that the domain is theirs.`,
      },
      { type: 'code', label: t ? 'Doğrulama kodu' : 'Verification code', value: input.code },
      {
        type: 'paragraph',
        text: t
          ? `Bunu bekliyorduysanız kodu bağlantıyı kuran kişiye iletin. Kod ${ttl} geçerlidir.`
          : `If you were expecting this, pass the code to the person setting up the connection. It expires in ${ttl}.`,
      },
      {
        type: 'note',
        text: t
          ? `Beklemiyorduysanız bu e-postayı yok sayın. Kod olmadan ${d} için hiçbir şey değişmez ve kimse adreslerinizden biriyle giriş yapamaz.`
          : `If you were not expecting this, ignore this email. Without the code nothing about ${d} changes, and nobody can sign in as one of your addresses.`,
      },
    ],
    footer: [
      t
        ? `Bu e-postayı, ${d} alan adının yönetici adresi olduğunuz için aldınız.`
        : `You received this email because this is an administrative address for ${d}.`,
      signature(ctx),
    ],
  });
}

export function visitorMessageMail(
  ctx: MailContext,
  input: { agentName: string | null; workspaceName: string; inboxUrl: string; settingsUrl: string },
): RenderedEmail {
  const t = tr(ctx.locale);
  const name = input.agentName?.trim();
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t ? 'Bir ziyaretçiden yeni mesaj' : 'New message from a visitor',
    preheader: t
      ? 'Size atanmış bir sohbette yanıt bekleyen bir mesaj var.'
      : 'A message is waiting for you in a conversation assigned to you.',
    icon: ICON.speech,
    heading: t ? 'Bir ziyaretçi size yazdı' : 'A visitor sent you a message',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `${name ? `Merhaba ${name},` : 'Merhaba,'} size atanmış bir sohbette bir ziyaretçi az önce yeni bir mesaj gönderdi.`
          : `${name ? `Hi ${name},` : 'Hi,'} a visitor just sent a new message in a conversation assigned to you.`,
      },
      {
        type: 'button',
        label: t ? 'Gelen kutusunu aç' : 'Open your inbox',
        url: input.inboxUrl,
        fallback: fallback(ctx),
      },
      {
        type: 'link',
        label: t ? 'E-posta bildirimlerini yönet' : 'Manage email notifications',
        url: input.settingsUrl,
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, hesabınızda e-posta bildirimleri açık olduğu için aldınız.'
        : 'You received this email because email notifications are on for your account.',
      signature(ctx),
    ],
  });
}

export interface TranscriptMessage {
  role: TranscriptRole;
  who: string;
  text: string;
  at: Date;
}

/**
 * The conversation, one block per calendar day in the workspace's time zone —
 * a reader cares that it was "Saturday at 09:14 in Istanbul", not an ISO stamp.
 */
function transcriptBlocks(
  locale: MailLocale,
  timeZone: string,
  messages: readonly TranscriptMessage[],
): EmailBlock[] {
  const blocks: EmailBlock[] = [];
  let currentDay = '';
  let entries: TranscriptEntry[] = [];
  const flush = (): void => {
    if (entries.length > 0) blocks.push({ type: 'transcript', date: currentDay, entries });
    entries = [];
  };
  for (const message of messages) {
    const day = formatDay(message.at, locale, timeZone);
    if (day !== currentDay) {
      flush();
      currentDay = day;
    }
    entries.push({
      role: message.role,
      who: message.who,
      time: formatTime(message.at, locale, timeZone),
      text: message.text,
    });
  }
  flush();
  return blocks;
}

export function customerTranscriptMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    chatId: string;
    timeZone: string;
    messages: readonly TranscriptMessage[];
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const ws = input.workspaceName;
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    sender: ws,
    eyebrow: ws,
    subject: t ? `${ws} ile görüşmenizin kopyası` : `Your conversation with ${ws}`,
    preheader: t
      ? 'Kayıtlarınız için görüşmenin tam metni.'
      : 'The full conversation, for your records.',
    icon: ICON.receipt,
    heading: t ? 'Görüşmenizin kopyası' : 'A copy of your conversation',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `${ws} ile yazıştığınız için teşekkürler. Görüşmenin tamamı aşağıda.`
          : `Thanks for chatting with ${ws}. Here is the whole conversation for your records.`,
      },
      ...transcriptBlocks(ctx.locale, input.timeZone, input.messages),
      {
        type: 'note',
        text: t
          ? `Görüşme numarası: ${input.chatId} · ${zoneSentence(ctx.locale, input.timeZone)}`
          : `Conversation ID: ${input.chatId} · ${zoneSentence(ctx.locale, input.timeZone)}`,
      },
    ],
    footer: [
      t
        ? `Bu e-postayı, ${ws} ile sohbet ederken e-posta adresinizi paylaştığınız için aldınız.`
        : `You received this email because you shared your email address while chatting with ${ws}.`,
      poweredBy(ctx.locale),
    ],
  });
}

export function teamTranscriptMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    customerName: string;
    chatId: string;
    timeZone: string;
    messages: readonly TranscriptMessage[];
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const who = input.customerName;
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `Sohbet dökümü: ${who} (${input.chatId})`
      : `Chat transcript: ${who} (${input.chatId})`,
    preheader: t
      ? 'Arşivlenen görüşmenin tam metni, dahili notlarla birlikte.'
      : 'The full archived conversation, internal notes included.',
    icon: ICON.clipboard,
    heading: t ? `${who} ile görüşme` : `Conversation with ${who}`,
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `${who} ile görüşme arşivlendi. Dahili notlar dahil tam döküm aşağıda.`
          : `The conversation with ${who} was archived. Here is the full transcript, internal notes included.`,
      },
      ...transcriptBlocks(ctx.locale, input.timeZone, input.messages),
      {
        type: 'note',
        text: t
          ? `Görüşme numarası: ${input.chatId} · ${zoneSentence(ctx.locale, input.timeZone)}`
          : `Conversation ID: ${input.chatId} · ${zoneSentence(ctx.locale, input.timeZone)}`,
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, görüşme size atanmış olduğu için aldınız.'
        : 'You received this email because the conversation was assigned to you.',
      signature(ctx),
    ],
  });
}

export function scheduledReportMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    reportLabel: string;
    from: string;
    to: string;
    rowCount: number;
    filename: string;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const period = `${input.from} – ${input.to}`;
  const rows = t
    ? `${input.rowCount} satır`
    : `${input.rowCount} ${input.rowCount === 1 ? 'row' : 'rows'}`;
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `Planlı rapor: ${input.reportLabel} (${period})`
      : `Scheduled report: ${input.reportLabel} (${period})`,
    preheader: t
      ? input.rowCount === 0
        ? 'Bu dönem için veri yok.'
        : `${rows}, CSV dosyası olarak ekte.`
      : input.rowCount === 0
        ? 'There was no data for this period.'
        : `${rows}, attached as a CSV file.`,
    icon: ICON.chart,
    heading: t ? `${input.reportLabel} raporu` : `${input.reportLabel} report`,
    blocks: [
      {
        type: 'paragraph',
        text:
          input.rowCount === 0
            ? t
              ? `${period} dönemi için raporda veri yok. Ekteki dosya yalnızca başlık satırını içeriyor.`
              : `There was no data for ${period}. The attached file holds only the header row.`
            : t
              ? `${period} dönemine ait planlı raporunuz ekte. CSV dosyasını Excel, Numbers ya da Google E-Tablolar ile açabilirsiniz.`
              : `Your scheduled report for ${period} is attached. Open the CSV file in Excel, Numbers or Google Sheets.`,
      },
      {
        type: 'facts',
        rows: [
          [t ? 'Dönem' : 'Period', period],
          [t ? 'Satır' : 'Rows', String(input.rowCount)],
          [t ? 'Dosya' : 'File', input.filename],
        ],
      },
    ],
    footer: [
      t
        ? `Bu e-postayı, ${input.workspaceName} çalışma alanındaki planlı bir raporun alıcı listesinde olduğunuz için aldınız. Listeyi bir yönetici Raporlar bölümünden değiştirebilir.`
        : `You received this email because you are on the recipient list of a scheduled report in ${input.workspaceName}. An admin can change the list in Reports.`,
      signature(ctx),
    ],
  });
}

export interface SlaBreachLine {
  subjectType: string;
  subjectId: string;
  target: 'first_response' | 'resolution' | string;
  targetMinutes: number;
  elapsedMinutes: number;
}

/** The owner's alert that SLA targets were missed (FR-MOD-11.5). */
export function slaBreachMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    breaches: readonly SlaBreachLine[];
    /** How many more were missed than are listed. */
    more: number;
    reportsUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const total = input.breaches.length + input.more;
  const dur = (minutes: number): string => duration(ctx.locale, minutes);
  const what = (target: string): string =>
    target === 'first_response' ? (t ? 'İlk yanıt' : 'First response') : t ? 'Çözüm' : 'Resolution';
  const kind = (type: string): string =>
    type === 'ticket' ? (t ? 'Talep' : 'Ticket') : t ? 'Sohbet' : 'Chat';
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.workspaceName} çalışma alanında ${total} SLA hedefi kaçırıldı. Hangi görüşmede, hangi hedefin ne kadar aşıldığı aşağıda.`
        : `${total} SLA ${total === 1 ? 'target was' : 'targets were'} missed in ${input.workspaceName}. Here is which conversation missed which target, and by how much.`,
    },
    {
      type: 'facts',
      rows: input.breaches.map((b) => [
        `${kind(b.subjectType)} · ${what(b.target)}`,
        // The whole id: it is what the inbox and Reports can be searched by.
        t
          ? `${dur(b.elapsedMinutes)} (hedef ${dur(b.targetMinutes)}) · ${b.subjectId}`
          : `${dur(b.elapsedMinutes)} (target ${dur(b.targetMinutes)}) · ${b.subjectId}`,
      ]),
    },
  ];
  if (input.more > 0) {
    blocks.push({
      type: 'note',
      text: t ? `…ve ${input.more} tane daha.` : `…and ${input.more} more.`,
    });
  }
  if (input.reportsUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Raporlarda gör' : 'See it in Reports',
      url: input.reportsUrl,
      fallback: fallback(ctx),
    });
  }
  blocks.push({
    type: 'note',
    text: t
      ? 'SiyahTuş SLA hedeflerini ölçer ve işaretler; arkasındaki görüşmeleri kendiliğinden yeniden yönlendirmez ya da önceliğini değiştirmez.'
      : 'SiyahTuş measures and marks SLA targets; it does not re-route or re-prioritise the conversations behind them.',
  });
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `SiyahTuş: ${total} SLA hedefi kaçırıldı`
      : `SiyahTuş: ${total} SLA ${total === 1 ? 'target' : 'targets'} missed`,
    preheader: t
      ? 'Hangi görüşmenin hangi hedefi aştığını görün.'
      : 'See which conversations missed which targets.',
    icon: ICON.alarm,
    tone: 'alert',
    heading: t ? 'SLA hedefleri kaçırıldı' : 'SLA targets missed',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, çalışma alanının sahibi olduğunuz ve e-posta bildirimleriniz açık olduğu için aldınız.'
        : 'You received this email because you own this workspace and have email notifications on.',
      signature(ctx),
    ],
  });
}

/**
 * A share of a workspace's daily AI allowance is used (tm 283.3 · AI-16-S2):
 * 80% as a warning, 100% when the AI has stopped answering for the day. Sent
 * to the owner and the recipients the owner chose; numbers only — no
 * conversation, no text a visitor wrote.
 */
export function aiUsageAlertMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    meter: 'llm' | 'embedding';
    threshold: 80 | 100;
    used: number;
    cap: number;
    /** The next 00:00 UTC, when the allowance renews. */
    resetsAt: Date;
    usageUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const number = (value: number): string =>
    new Intl.NumberFormat(t ? 'tr-TR' : 'en-US').format(value);
  const full = input.threshold === 100;
  const what =
    input.meter === 'llm'
      ? t
        ? 'Yapay zekâ yanıtları (dil modeli)'
        : 'AI replies (language model)'
      : t
        ? 'Bilgi arama (embedding)'
        : 'Knowledge search (embedding)';
  const renews = `${formatDateTime(input.resetsAt, ctx.locale, 'UTC')} UTC`;
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: full
        ? t
          ? `${input.workspaceName} çalışma alanının bugünkü yapay zekâ kotası doldu. Kota yenilenene kadar yapay zekâ yeni mesajlara yanıt vermez; mesajlar insan temsilcilere kalır.`
          : `Today's AI allowance for ${input.workspaceName} is used up. Until it renews the AI does not answer new messages; they wait for a human agent.`
        : t
          ? `${input.workspaceName} çalışma alanı bugünkü yapay zekâ kotasının %${input.threshold}'ini kullandı. Kota dolarsa yapay zekâ gün sonuna kadar yanıt vermez.`
          : `${input.workspaceName} has used ${input.threshold}% of today's AI allowance. If it runs out, the AI stops answering until the day ends.`,
    },
    {
      type: 'facts',
      rows: [
        [t ? 'Kullanım' : 'Usage', what],
        [
          t ? 'Bugün' : 'Today',
          t
            ? `${number(input.used)} / ${number(input.cap)} token`
            : `${number(input.used)} / ${number(input.cap)} tokens`,
        ],
        [t ? 'Yenilenme' : 'Renews', renews],
      ],
    },
  ];
  if (input.usageUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Kullanımı gör' : 'See usage',
      url: input.usageUrl,
      fallback: fallback(ctx),
    });
  }
  blocks.push({
    type: 'note',
    text: t
      ? 'Günler UTC saatine göre sayılır. Kotayı SiyahTuş ekibi belirler; artırmak için bizimle iletişime geçin.'
      : 'Days are counted in UTC. The allowance is set by the SiyahTuş team; contact us to raise it.',
  });
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: full
      ? t
        ? 'SiyahTuş: bugünkü yapay zekâ kotası doldu'
        : "SiyahTuş: today's AI allowance is used up"
      : t
        ? `SiyahTuş: bugünkü yapay zekâ kotasının %${input.threshold}'i kullanıldı`
        : `SiyahTuş: ${input.threshold}% of today's AI allowance used`,
    preheader: full
      ? t
        ? `Yapay zekâ ${renews} saatine kadar yanıt vermiyor.`
        : `The AI is not answering until ${renews}.`
      : t
        ? 'Kullanımı panelden izleyebilirsiniz.'
        : 'You can follow usage in the panel.',
    icon: full ? ICON.alarm : ICON.chart,
    tone: full ? 'alert' : 'brand',
    heading: full
      ? t
        ? 'Yapay zekâ kotası doldu'
        : 'AI allowance used up'
      : t
        ? `Yapay zekâ kotasının %${input.threshold}'i kullanıldı`
        : `${input.threshold}% of the AI allowance used`,
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının sahibi ya da yapay zekâ kullanım uyarılarının alıcısı olduğunuz için aldınız.'
        : 'You received this email because you own this workspace or receive its AI usage alerts.',
      signature(ctx),
    ],
  });
}

/**
 * A ticket update a workspace wrote itself (FR-MOD-08.7.5): its subject and
 * its text, untouched, inside the shared frame. The workspace's words are the
 * whole message: the HTML puts them in the frame (escaped like everything
 * else), and the plain-text half is exactly what they wrote — no heading or
 * footer of ours added to a message that speaks in their voice.
 */
export function ticketNoticeMail(
  ctx: MailContext,
  input: { workspaceName: string; subject: string; body: string },
): RenderedEmail {
  const t = tr(ctx.locale);
  const rendered = renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    sender: input.workspaceName,
    eyebrow: input.workspaceName,
    subject: input.subject,
    preheader: firstLine(input.body),
    heading: input.subject,
    blocks: [{ type: 'verbatim', text: input.body }],
    footer: [
      t
        ? `Bu e-postayı, ${input.workspaceName} ile açık bir talebiniz olduğu için aldınız.`
        : `You received this email because you have a request open with ${input.workspaceName}.`,
      poweredBy(ctx.locale),
    ],
  });
  return { ...rendered, body: input.body };
}

// --- Formatting -------------------------------------------------------------------

/** `12 min`, `8 h`, `10 h 55 min` — a duration a person reads at a glance. */
export function duration(locale: MailLocale, minutes: number): string {
  const [h, m] = tr(locale) ? ['sa', 'dk'] : ['h', 'min'];
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} ${m}`;
  return rest === 0 ? `${hours} ${h}` : `${hours} ${h} ${rest} ${m}`;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

function zone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** "Times are in Europe/Istanbul time." — said once, under the transcript. */
function zoneSentence(locale: MailLocale, timeZone: string): string {
  const label = zoneLabel(timeZone);
  if (tr(locale))
    return label === 'UTC' ? "Saatler UTC'ye göredir." : `Saatler ${label} saatine göredir.`;
  return label === 'UTC' ? 'Times are in UTC.' : `Times are in ${label} time.`;
}

function zoneLabel(timeZone: string): string {
  const z = zone(timeZone);
  return z === 'UTC' ? 'UTC' : z.replace(/_/g, ' ');
}

function intlLocale(locale: MailLocale): string {
  return locale === 'tr' ? 'tr-TR' : 'en-GB';
}

export function formatDay(date: Date, locale: MailLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: zone(timeZone),
  }).format(date);
}

export function formatTime(date: Date, locale: MailLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone(timeZone),
  }).format(date);
}

export function formatDateTime(date: Date, locale: MailLocale, timeZone: string): string {
  return `${new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone(timeZone),
  }).format(date)} ${zoneLabel(timeZone)}`;
}
