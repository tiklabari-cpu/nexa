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
import type { CapabilityKey, CapabilityValue, MatrixRole } from '@siyahtus/types';
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

/**
 * The password was changed from inside the panel (RL-06 · tm 327). Sent every
 * time, like the two-factor notice above: the person who did it learns
 * nothing new, the person who did not learns the one thing they must act on.
 */
export function passwordChangedMail(
  ctx: MailContext,
  input: {
    email: string;
    workspaceName: string;
    at: Date;
    endedSessions: number;
    resetUrl: string;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    subject: t ? 'SiyahTuş şifreniz değiştirildi' : 'Your SiyahTuş password was changed',
    preheader: t
      ? 'Hesabınızda bir güvenlik değişikliği oldu; sizin yaptığınızdan emin olun.'
      : 'A security setting on your account changed. Make sure it was you.',
    icon: ICON.lock,
    heading: t ? 'Şifreniz değiştirildi' : 'Your password was changed',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? 'Hesabınızın şifresi, oturum açık bir cihazdan mevcut şifre girilerek az önce değiştirildi. Bu cihaz dışındaki bütün oturumlar kapatıldı.'
          : 'The password for your account was just changed from a signed-in device, with the current password. Every other session was signed out.',
      },
      {
        type: 'facts',
        rows: [
          [t ? 'Hesap' : 'Account', input.email],
          [t ? 'Çalışma alanı' : 'Workspace', input.workspaceName],
          [t ? 'Zaman' : 'When', formatDateTime(input.at, ctx.locale, 'UTC')],
          [t ? 'Kapatılan oturum' : 'Sessions signed out', String(input.endedSessions)],
        ],
      },
      {
        type: 'callout',
        text: t
          ? 'Bunu siz yapmadıysanız hesabınıza başkası erişmiş olabilir. Aşağıdaki bağlantıyla şifrenizi hemen sıfırlayın ve çalışma alanının bir sahibine haber verin.'
          : 'If this was not you, someone else may have access to your account. Reset your password now with the link below, and tell an owner of the workspace.',
      },
      {
        type: 'button',
        label: t ? 'Şifreyi sıfırla' : 'Reset password',
        url: input.resetUrl,
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

// --- Platform (root panel) mail -----------------------------------------------------

/** How an operator role reads in a sentence. */
function platformRoleName(locale: MailLocale, role: string): string {
  const names: Record<string, { en: string; tr: string }> = {
    superadmin: { en: 'superadmin', tr: 'süper yönetici' },
    support: { en: 'support', tr: 'destek' },
    billing: { en: 'billing', tr: 'faturalama' },
    readonly: { en: 'read-only', tr: 'salt okunur' },
  };
  const name = names[role];
  return name ? name[locale] : role;
}

/**
 * An invitation to operate the deployment's root panel (tm 389.4 · FR-ADMIN-03)
 * — not a workspace invitation: the reader becomes an operator of every
 * workspace's platform, so the mail says what the role is and that an
 * authenticator app is required before anything opens.
 */
export function platformInvitationMail(
  ctx: MailContext,
  input: { url: string; role: string; inviterEmail: string | null; hours: number },
): RenderedEmail {
  const t = tr(ctx.locale);
  const ttl = hoursText(ctx.locale, input.hours);
  const role = platformRoleName(ctx.locale, input.role);
  const who = input.inviterEmail?.trim() || null;
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: 'SiyahTuş Platform',
    subject: t
      ? 'SiyahTuş platform yönetimine davet edildiniz'
      : 'You have been invited to operate the SiyahTuş platform',
    preheader: t
      ? 'Bir şifre belirleyin ve doğrulama uygulamanızı bağlayın.'
      : 'Choose a password and connect your authenticator app.',
    icon: ICON.key,
    heading: t ? 'Platform yönetimine katılın' : 'Join the platform team',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `${who ?? 'Bir süper yönetici'}, sizi bu SiyahTuş kurulumunun yönetim paneline ${role} rolüyle davet etti.`
          : `${who ?? 'A superadmin'} has invited you to this SiyahTuş deployment's back office with the ${role} role.`,
      },
      {
        type: 'paragraph',
        text: t
          ? 'Daveti kabul ederken bir şifre belirlersiniz; ardından doğrulama uygulamanızı (Google Authenticator, 1Password vb.) bağlamadan hiçbir sayfa açılmaz.'
          : 'Accepting it asks you for a password; nothing opens until you have also connected an authenticator app (Google Authenticator, 1Password and the like).',
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
          ? `Davet ${ttl} geçerlidir ve yalnızca bir kez kullanılabilir. Beklemediğiniz bir davetse bu e-postayı yok sayın ve kurulumun yöneticisine haber verin.`
          : `The invitation expires in ${ttl} and works once. If you were not expecting it, ignore this email and tell whoever runs this deployment.`,
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, bu kurulumun bir süper yöneticisi sizi davet ettiği için aldınız.'
        : 'You received this email because a superadmin of this deployment invited you.',
      signature(ctx),
    ],
  });
}

/**
 * The owner's notice that SiyahTuş has scheduled their workspace for deletion
 * (tm 389.10 · FR-ADMIN-09): it is suspended now, and its data goes on
 * `purgeAt` unless the deletion is cancelled first. Sent by the platform — the
 * workspace itself is locked, so nothing inside it could say so.
 */
export function workspacePurgeScheduledMail(
  ctx: MailContext,
  input: { workspaceName: string; purgeAt: string; days: number },
): RenderedEmail {
  const t = tr(ctx.locale);
  const days = daysText(ctx.locale, input.days);
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `${input.workspaceName} çalışma alanı silinmek üzere planlandı`
      : `Your workspace ${input.workspaceName} is scheduled for deletion`,
    preheader: t
      ? `Verileri ${days} sonra silinecek. Vazgeçmek için bizimle iletişime geçin.`
      : `Its data will be deleted in ${days}. Contact us if this should not happen.`,
    icon: ICON.alarm,
    heading: t ? 'Çalışma alanınız silinecek' : 'Your workspace will be deleted',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `SiyahTuş ekibi ${input.workspaceName} çalışma alanını silinmek üzere planladı. Çalışma alanı şu andan itibaren askıda: kimse giriş yapamaz, ziyaretçiler sohbet başlatamaz.`
          : `The SiyahTuş team has scheduled the workspace ${input.workspaceName} for deletion. It is suspended from now on: nobody can sign in and visitors cannot start a chat.`,
      },
      {
        type: 'paragraph',
        text: t
          ? `Sohbetler, kayıtlar ve ayarlar dahil tüm verileri ${input.purgeAt} tarihinde (${days} sonra) kalıcı olarak silinecek.`
          : `All of its data — conversations, records and settings — will be deleted for good on ${input.purgeAt} (in ${days}).`,
      },
      {
        type: 'note',
        text: t
          ? 'Bu bir hataysa ya da verilerinizi dışa aktarmanız gerekiyorsa, bu tarihten önce bu e-postayı yanıtlayarak ya da destek ekibimize yazarak bize ulaşın; silme işlemi o zamana kadar geri alınabilir.'
          : 'If this is a mistake, or you need to export your data first, reply to this email or write to our support team before that date — until then the deletion can be cancelled.',
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının Kurucusu olduğunuz için aldınız.'
        : 'You received this email because you are the owner of this workspace.',
      signature(ctx),
    ],
  });
}

/** A calendar date in the reader's language, in UTC (the dates billing keeps). */
function billingDate(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * The owner's subscription cancellation (tm 384 · BL-03), to the owners:
 * `scheduled` when it is set (it ends with the period, nothing is refunded,
 * it can be taken back until then), `resumed` when it is taken back, and
 * `ended` when the period ended (read-only, export until, deletion on).
 */
export function subscriptionCancelMail(
  ctx: MailContext,
  input: { workspaceName: string; billingUrl: string | null } & (
    | { kind: 'scheduled'; takesEffectAt: Date }
    | { kind: 'resumed' }
    | { kind: 'ended'; exportUntil: Date; dataDeletionAt: Date | null }
  ),
): RenderedEmail {
  const t = tr(ctx.locale);
  const name = input.workspaceName;
  const blocks: EmailBlock[] = [];
  let subject: string;
  let preheader: string;
  let heading: string;
  if (input.kind === 'scheduled') {
    const on = billingDate(input.takesEffectAt, ctx.locale);
    subject = t
      ? `${name} aboneliği ${on} tarihinde sona erecek`
      : `${name}'s subscription ends on ${on}`;
    preheader = t
      ? 'O güne kadar her şey çalışır; iptali geri alabilirsiniz.'
      : 'Everything works until then, and you can undo the cancellation.';
    heading = t ? 'Aboneliğiniz iptal edildi' : 'Your subscription is cancelled';
    blocks.push(
      {
        type: 'paragraph',
        text: t
          ? `${name} çalışma alanının aboneliği dönem sonunda, ${on} tarihinde sona erecek. O güne kadar çalışma alanı her zamanki gibi çalışır. Kalan süre için iade yapılmaz.`
          : `The subscription of the workspace ${name} ends with its period, on ${on}. Until then the workspace works as usual. The remaining time is not refunded.`,
      },
      {
        type: 'paragraph',
        text: t
          ? `Dönem sonunda çalışma alanı salt okunur olur: veriler okunabilir ve 30 gün boyunca dışa aktarılabilir. Fikrinizi değiştirirseniz ${on} tarihine kadar iptali geri alabilirsiniz.`
          : `When the period ends the workspace becomes read-only: its data stays readable and can be exported for 30 days. If you change your mind, you can undo the cancellation until ${on}.`,
      },
    );
  } else if (input.kind === 'resumed') {
    subject = t ? `${name} aboneliği devam ediyor` : `${name}'s subscription continues`;
    preheader = t ? 'İptal geri alındı.' : 'The cancellation was undone.';
    heading = t ? 'İptal geri alındı' : 'Cancellation undone';
    blocks.push({
      type: 'paragraph',
      text: t
        ? `${name} çalışma alanının abonelik iptali geri alındı. Abonelik dönem sonunda her zamanki gibi yenilenir.`
        : `The cancellation of the workspace ${name}'s subscription was undone. The subscription renews at the end of the period as usual.`,
    });
  } else {
    const until = billingDate(input.exportUntil, ctx.locale);
    subject = t ? `${name} aboneliği sona erdi` : `${name}'s subscription has ended`;
    preheader = t
      ? `${until} tarihine kadar verilerinizi dışa aktarabilirsiniz.`
      : `You can export your data until ${until}.`;
    heading = t ? 'Aboneliğiniz sona erdi' : 'Your subscription has ended';
    blocks.push(
      {
        type: 'paragraph',
        text: t
          ? `${name} çalışma alanı artık salt okunur. Veriler okunabilir ve ${until} tarihine kadar dışa aktarılabilir; bu tarihten sonra çalışma alanına giriş yapılamaz.`
          : `The workspace ${name} is now read-only. Its data stays readable and can be exported until ${until}; after that nobody can sign in to it.`,
      },
      {
        type: 'paragraph',
        text: input.dataDeletionAt
          ? t
            ? `Veriler, çalışma alanının saklama ayarına göre ${billingDate(input.dataDeletionAt, ctx.locale)} tarihinde kalıcı olarak silinecek.`
            : `Following the workspace's retention setting, its data will be deleted for good on ${billingDate(input.dataDeletionAt, ctx.locale)}.`
          : t
            ? 'Çalışma alanının saklama ayarı "sınırsız" olduğu için veriler kendiliğinden silinmez.'
            : 'The workspace keeps its conversations without limit, so its data is not deleted automatically.',
      },
      {
        type: 'note',
        text: t
          ? 'Yeniden abone olmak yeni bir satın almadır ve çalışma alanını salt okunur durumdan çıkarır.'
          : 'Subscribing again is a new purchase and takes the workspace out of read-only.',
      },
    );
  }
  if (input.billingUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Faturalandırmayı aç' : 'Open billing',
      url: input.billingUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: name,
    subject,
    preheader,
    icon: ICON.alarm,
    heading,
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının Kurucusu olduğunuz için aldınız.'
        : 'You received this email because you are the owner of this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * The SiyahTuş team answered a crypto payment request (tm 389.18 · FR-ADMIN-14
 * · ADR-13a §3): the wallet address is waiting on the request in Billing. The
 * mail does not carry the address — a reader confirms where to send money
 * signed in, on the request itself, never from a message anyone could forge.
 */
export function paymentAddressSentMail(
  ctx: MailContext,
  input: { workspaceName: string; network: string; amount: string; billingUrl: string | null },
): RenderedEmail {
  const t = tr(ctx.locale);
  const name = input.workspaceName;
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${name} çalışma alanının kripto ödeme talebine yanıt verdik: ${input.network} ağı için cüzdan adresi Faturalandırma sayfasındaki talebinizde sizi bekliyor. Ödenecek tutar ${input.amount}.`
        : `We answered the crypto payment request of the workspace ${name}: the wallet address for ${input.network} is waiting on your request on the Billing page. The amount to send is ${input.amount}.`,
    },
    {
      type: 'paragraph',
      text: t
        ? 'Transferi yaptıktan sonra işlem kimliğini (TXID) aynı talebe yazın; ekibimiz işlemi zincirde doğruladığında aboneliğiniz etkinleşir.'
        : 'Once you have made the transfer, write its transaction id (TXID) on the same request; your subscription is active as soon as our team has found it on the chain.',
    },
    {
      type: 'note',
      text: t
        ? 'Güvenliğiniz için adresi bu e-postaya yazmadık. Adresi yalnızca oturum açıp talebinizde görün; başka bir yoldan gelen adrese ödeme yapmayın.'
        : 'For your safety this email does not carry the address. Read it only on your request, signed in, and never pay to an address that reached you any other way.',
    },
  ];
  if (input.billingUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Faturalandırmayı aç' : 'Open billing',
      url: input.billingUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: name,
    subject: t ? `${name}: ödeme adresiniz hazır` : `${name}: your payment address is ready`,
    preheader: t
      ? 'Cüzdan adresi Faturalandırma sayfasındaki talebinizde.'
      : 'The wallet address is on your request on the Billing page.',
    icon: ICON.receipt,
    heading: t ? 'Ödeme adresiniz hazır' : 'Your payment address is ready',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının Kurucusu olduğunuz için aldınız.'
        : 'You received this email because you are the owner of this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * SiyahTuş moved a workspace's ownership by hand (tm 389.10 · FR-ADMIN-09 —
 * the forced transfer, when the owner could not be reached). Everyone with a
 * stake hears it: the new owner, the previous one, and every admin — so a
 * transfer nobody asked for cannot go unnoticed. `role` says which one the
 * reader is.
 */
export function ownershipTransferredMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    newOwner: string;
    previousOwner: string | null;
    role: 'new_owner' | 'previous_owner' | 'admin';
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const lead = (): string => {
    switch (input.role) {
      case 'new_owner':
        return t
          ? `SiyahTuş destek ekibi, kimlik doğrulamasının ardından ${input.workspaceName} çalışma alanının Kurucusu olarak sizi atadı.`
          : `After verifying your identity, the SiyahTuş support team has made you the owner of the workspace ${input.workspaceName}.`;
      case 'previous_owner':
        return t
          ? `SiyahTuş destek ekibi, ${input.workspaceName} çalışma alanının sahipliğini ${input.newOwner} kişisine devretti. Siz artık bu çalışma alanında Yöneticisiniz.`
          : `The SiyahTuş support team has transferred ownership of the workspace ${input.workspaceName} to ${input.newOwner}. You are now an admin of it.`;
      case 'admin':
        return t
          ? `SiyahTuş destek ekibi, ${input.workspaceName} çalışma alanının sahipliğini ${input.previousOwner ? `${input.previousOwner} kişisinden ` : ''}${input.newOwner} kişisine devretti.`
          : `The SiyahTuş support team has transferred ownership of the workspace ${input.workspaceName}${input.previousOwner ? ` from ${input.previousOwner}` : ''} to ${input.newOwner}.`;
    }
  };
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `${input.workspaceName} çalışma alanının sahipliği devredildi`
      : `Ownership of ${input.workspaceName} has been transferred`,
    preheader: t ? `Yeni Kurucu: ${input.newOwner}.` : `The new owner is ${input.newOwner}.`,
    icon: ICON.lock,
    heading: t ? 'Sahiplik devredildi' : 'Ownership transferred',
    blocks: [
      { type: 'paragraph', text: lead() },
      {
        type: 'note',
        text: t
          ? 'Bu devri beklemiyorsanız hemen destek ekibimize yazın.'
          : 'If you did not expect this transfer, write to our support team straight away.',
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanında Kurucu ya da Yönetici olduğunuz için aldınız.'
        : 'You received this email because you are an owner or admin of this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * A SiyahTuş operator has entered the workspace as one of its members (tm
 * 389.15 · FR-ADMIN-21): the Founders hear it when the session opens — who was
 * entered as, whether anything could be changed, until when. Never the
 * operator's reason (that stays in the platform's own trail) and never who
 * the operator is beyond "the support team"; the workspace's audit log names
 * the session. No mail when it ends (requirements §6.3).
 */
export function impersonationNoticeMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    memberEmail: string;
    mode: 'read_only' | 'full';
    endsAt: string;
    minutes: number;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const window = duration(ctx.locale, input.minutes);
  const readOnly = input.mode === 'read_only';
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `SiyahTuş destek ekibi ${input.workspaceName} çalışma alanınıza giriş yaptı`
      : `SiyahTuş support has entered your workspace ${input.workspaceName}`,
    preheader: t
      ? `${input.memberEmail} olarak, ${input.endsAt} saatine kadar.`
      : `As ${input.memberEmail}, until ${input.endsAt}.`,
    icon: ICON.account,
    heading: t ? 'Destek ekibi çalışma alanınızda' : 'Support is in your workspace',
    blocks: [
      {
        type: 'paragraph',
        text: t
          ? `SiyahTuş destek ekibinden biri, bir sorunu incelemek için ${input.workspaceName} çalışma alanına ${input.memberEmail} üyesi olarak giriş yaptı.`
          : `Someone from the SiyahTuş support team has entered the workspace ${input.workspaceName} as the member ${input.memberEmail}, to look into an issue.`,
      },
      {
        type: 'facts',
        rows: [
          [t ? 'Üye' : 'Member', input.memberEmail],
          [
            t ? 'Yetki' : 'Access',
            readOnly
              ? t
                ? 'Salt okunur — hiçbir şey değiştirilemez'
                : 'Read-only — nothing can be changed'
              : t
                ? 'Tam — üyenin rolüyle işlem yapabilir'
                : 'Full — can act with the member’s role',
          ],
          [t ? 'Bitiş' : 'Ends', `${input.endsAt} (${window})`],
        ],
      },
      {
        type: 'paragraph',
        text: t
          ? 'Oturum sırasında yapılan her işlem, denetim kaydınızda SiyahTuş destek ekibinin adına ve bu üye için yapılmış olarak görünür. Parola, iki adımlı doğrulama, erişim anahtarları, güvenlik ayarları ve ödeme bu oturumdan değiştirilemez.'
          : 'Anything done during the session appears in your audit log as done by the SiyahTuş support team on this member’s behalf. Passwords, two-step verification, access keys, security settings and payment cannot be changed from it.',
      },
      {
        type: 'note',
        text: t
          ? 'Bu girişi beklemiyorsanız hemen destek ekibimize yazın.'
          : 'If you did not expect this, write to our support team straight away.',
      },
    ],
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının Kurucusu olduğunuz için aldınız.'
        : 'You received this email because you are the owner of this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * What an operator alert is about (tm 389.20 · FR-ADMIN-24). Names, ids,
 * numbers and times only — never a message, a player or an article: the
 * platform's mail carries what its screens carry.
 */
export type PlatformAlertMailInput =
  | { kind: 'trial_ending'; workspaceName: string; workspaceId: string; endsAt: Date }
  | {
      kind: 'payment_request_waiting';
      workspaceName: string;
      workspaceId: string;
      requestedAt: Date;
      waitingHours: number;
    }
  | {
      kind: 'ai_cap_reached';
      workspaceName: string;
      workspaceId: string;
      meter: 'llm' | 'embedding';
      used: number;
      cap: number;
    }
  | { kind: 'health_red'; reason: 'stale' | 'degraded'; ageSeconds: number | null; detail: string }
  | { kind: 'audit_chain_broken'; findings: number; firstSeq: string | null; checked: number }
  | { kind: 'purge_tomorrow'; workspaceName: string; workspaceId: string; purgeAt: Date };

/**
 * The operator alert (tm 389.20 · FR-ADMIN-24): one condition on one target,
 * mailed to the operators who asked for it. `panelUrl` is the admin SPA's
 * page for the thing — absent, the mail still says everything it knows.
 */
export function platformAlertMail(
  ctx: MailContext,
  input: PlatformAlertMailInput,
  panelUrl: string | null,
): RenderedEmail {
  const t = tr(ctx.locale);
  const when = (date: Date): string => `${formatDateTime(date, ctx.locale, 'UTC')} UTC`;
  const number = (value: number): string =>
    new Intl.NumberFormat(t ? 'tr-TR' : 'en-US').format(value);
  let subject: string;
  let preheader: string;
  let heading: string;
  let paragraph: string;
  let rows: Array<readonly [string, string]>;
  let action: string;
  switch (input.kind) {
    case 'trial_ending':
      subject = t
        ? `Deneme süresi bitiyor: ${input.workspaceName}`
        : `Trial ending: ${input.workspaceName}`;
      preheader = t ? 'Deneme süresi üç gün içinde bitiyor.' : 'The trial ends within three days.';
      heading = t ? 'Bir deneme süresi bitiyor' : 'A trial is about to end';
      paragraph = t
        ? `${input.workspaceName} çalışma alanının deneme süresi ${when(input.endsAt)} tarihinde bitiyor. O zamana kadar bir plan seçilmezse çalışma alanı kapanır.`
        : `The trial of ${input.workspaceName} ends on ${when(input.endsAt)}. If no plan is chosen by then, the workspace closes.`;
      rows = [
        [t ? 'Çalışma alanı' : 'Workspace', `${input.workspaceName} (#${input.workspaceId})`],
        [t ? 'Bitiş' : 'Ends', when(input.endsAt)],
      ];
      action = t ? 'Çalışma alanını aç' : 'Open the workspace';
      break;
    case 'payment_request_waiting': {
      const hours = hoursText(ctx.locale, input.waitingHours);
      subject = t
        ? `Ödeme talebi bekliyor: ${input.workspaceName}`
        : `Payment request waiting: ${input.workspaceName}`;
      preheader = t ? `${input.waitingHours} saattir işlenmeyi bekliyor.` : `Waiting for ${hours}.`;
      heading = t ? 'Bir ödeme talebi bekliyor' : 'A payment request is waiting';
      paragraph = t
        ? `${input.workspaceName} çalışma alanının ödeme talebi ${input.waitingHours} saattir bir operatörün işlemesini bekliyor.`
        : `A payment request from ${input.workspaceName} has been waiting ${hours} for an operator.`;
      rows = [
        [t ? 'Çalışma alanı' : 'Workspace', `${input.workspaceName} (#${input.workspaceId})`],
        [t ? 'Talep zamanı' : 'Requested', when(input.requestedAt)],
      ];
      action = t ? 'Ödeme kuyruğunu aç' : 'Open the payment queue';
      break;
    }
    case 'ai_cap_reached':
      subject = t
        ? `Yapay zekâ kotası doldu: ${input.workspaceName}`
        : `AI allowance reached: ${input.workspaceName}`;
      preheader = t
        ? 'Çalışma alanının bugünkü kotası bitti.'
        : "The workspace's allowance for today is used up.";
      heading = t ? 'Bir çalışma alanı kotasına ulaştı' : 'A workspace reached its AI allowance';
      paragraph = t
        ? `${input.workspaceName} çalışma alanının bugünkü yapay zekâ kotası doldu; kota gece yarısı (UTC) yenilenir. Beklememesi gerekiyorsa kotayı panelden yükseltebilirsiniz.`
        : `${input.workspaceName} has used all of today's AI allowance; it renews at midnight UTC. Raise the cap from the panel if it should not wait.`;
      rows = [
        [t ? 'Çalışma alanı' : 'Workspace', `${input.workspaceName} (#${input.workspaceId})`],
        [
          t ? 'Sayaç' : 'Meter',
          input.meter === 'llm'
            ? t
              ? 'Dil modeli'
              : 'Language model'
            : t
              ? 'Bilgi arama (embedding)'
              : 'Knowledge search (embedding)',
        ],
        [
          t ? 'Bugün' : 'Today',
          t
            ? `${number(input.used)} / ${number(input.cap)} token`
            : `${number(input.used)} / ${number(input.cap)} tokens`,
        ],
      ];
      action = t ? 'Kullanımı aç' : 'Open usage';
      break;
    case 'health_red':
      subject = t ? 'Sağlık durumu kırmızı' : 'Platform health is red';
      preheader =
        input.reason === 'stale'
          ? t
            ? 'Sağlık anlık görüntüsü artık yenilenmiyor.'
            : 'The health snapshot is no longer refreshed.'
          : t
            ? 'Bir bağımlılık ya da bileşen sağlıksız.'
            : 'A dependency or component is unhealthy.';
      heading = t ? 'Sağlık kontrolü kırmızı' : 'The health check is red';
      paragraph =
        input.reason === 'stale'
          ? t
            ? 'Kiracı API lideri sağlık anlık görüntüsünü yayımlamıyor: son yayın çok eski ya da hiç yok. Kiracı API düşmüş olabilir.'
            : 'The tenant API leader is not publishing the health snapshot: the last one is too old or missing. The tenant API may be down.'
          : t
            ? `Sağlık anlık görüntüsü "degraded" bildiriyor: ${input.detail}.`
            : `The health snapshot reports "degraded": ${input.detail}.`;
      rows = [
        [t ? 'Durum' : 'State', input.reason],
        ...(input.ageSeconds === null
          ? []
          : [[t ? 'Yaş' : 'Age', `${Math.round(input.ageSeconds)} s`] as const]),
      ];
      action = t ? 'Sağlık sayfasını aç' : 'Open the health view';
      break;
    case 'audit_chain_broken':
      subject = t ? 'Denetim zinciri doğrulanamadı' : 'The audit chain no longer verifies';
      preheader = t
        ? 'Platform denetim zincirinde bozulma bulundu.'
        : 'The platform audit chain has a break.';
      heading = t ? 'Denetim zinciri bozuk' : 'The audit chain is broken';
      paragraph = t
        ? `Günlük doğrulama platform denetim zincirinde ${input.findings} bulgu buldu. Bir kayıt değiştirilmiş ya da silinmiş olabilir; ayrıntı için zinciri panelden doğrulayın.`
        : `The daily check found ${input.findings} finding${input.findings === 1 ? '' : 's'} in the platform audit chain. An entry may have been altered or removed; verify the chain from the panel for the detail.`;
      rows = [
        [t ? 'Bulgu' : 'Findings', number(input.findings)],
        [t ? 'İlk sıra' : 'First sequence', input.firstSeq ?? '-'],
        [t ? 'Denetlenen' : 'Checked', number(input.checked)],
      ];
      action = t ? 'Denetim kaydını aç' : 'Open the audit log';
      break;
    case 'purge_tomorrow':
      subject = t
        ? `Yarın silinecek: ${input.workspaceName}`
        : `Deleted tomorrow: ${input.workspaceName}`;
      preheader = t
        ? 'Çalışma alanının kalıcı silme tarihi yarın.'
        : "The workspace's deletion date is tomorrow.";
      heading = t ? 'Bir çalışma alanı yarın silinecek' : 'A workspace is deleted tomorrow';
      paragraph = t
        ? `${input.workspaceName} çalışma alanının verileri ${when(input.purgeAt)} tarihinde kalıcı olarak silinecek. Bu istenmiyorsa silme o zamandan önce iptal edilmelidir.`
        : `The data of ${input.workspaceName} is deleted for good on ${when(input.purgeAt)}. If that should not happen, cancel the deletion before then.`;
      rows = [
        [t ? 'Çalışma alanı' : 'Workspace', `${input.workspaceName} (#${input.workspaceId})`],
        [t ? 'Silme' : 'Deletion', when(input.purgeAt)],
      ];
      action = t ? 'Çalışma alanını aç' : 'Open the workspace';
      break;
  }
  const blocks: EmailBlock[] = [
    { type: 'paragraph', text: paragraph },
    { type: 'facts', rows },
  ];
  if (panelUrl) {
    blocks.push({ type: 'button', label: action, url: panelUrl, fallback: fallback(ctx) });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: 'SiyahTuş Platform',
    subject: `[OPS] ${subject}`,
    preheader,
    icon: ICON.alarm,
    heading,
    blocks,
    footer: [
      t
        ? 'Bu e-postayı platform uyarılarını açtığınız için aldınız; tercihleri yönetim panelinde değiştirebilirsiniz.'
        : 'You received this email because you turned platform alerts on; you can change that in the admin panel.',
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

/**
 * The figures a summary e-mail states (RP-05 · tm 372). Counts, seconds and
 * 0..1 shares only — there is no field a player's name, user name or message
 * text could travel in, and `digest-mail.test.ts` holds the rendered body to
 * the same rule.
 */
export interface DigestMailFigures {
  chats: number;
  closed: number;
  missed: number;
  avg_first_response_seconds: number | null;
  csat_score: number | null;
  csat_responses: number;
  ai_conversations: number;
  ai_resolved: number;
  ai_handed_off: number;
  risk_flagged_chats: number;
  queue_entries: number;
  queue_p80_wait_seconds: number | null;
}

/** `1 dk 20 sn` / `1 min 20 s` — whole seconds, spoken the way a desk reads a wait. */
function durationText(locale: MailLocale, seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const [m, s] = tr(locale) ? ['dk', 'sn'] : ['min', 's'];
  if (minutes === 0) return `${rest} ${s}`;
  return rest === 0 ? `${minutes} ${m}` : `${minutes} ${m} ${rest} ${s}`;
}

const MINUS = '−';
const NO_CHANGE = '±0';

const signed = (n: number): string =>
  n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : NO_CHANGE;

/**
 * Change against the period before: ` (+4)` for a count, ` (−10 s)` for a
 * duration, ` (+3 pts)` for a share. Nothing when either side is unknown — a
 * quiet previous day has no first-response time to compare with.
 */
function changeText(
  locale: MailLocale,
  kind: 'count' | 'seconds' | 'points',
  current: number | null,
  previous: number | null,
): string {
  if (current === null || previous === null) return '';
  if (kind === 'count') return ` (${signed(current - previous)})`;
  if (kind === 'seconds') {
    const diff = Math.round(current - previous);
    if (diff === 0) return ` (${NO_CHANGE})`;
    return ` (${diff > 0 ? '+' : MINUS}${durationText(locale, Math.abs(diff))})`;
  }
  const points = Math.round((current - previous) * 100);
  return ` (${signed(points)} ${tr(locale) ? 'puan' : 'pts'})`;
}

/**
 * The morning summary for one reader (RP-05 · tm 372): yesterday's — or last
 * week's — figures, each against the period before it, for the workspace or for
 * the teams the reader leads. Counts and durations only; the one link goes to the
 * Reports screen and carries team ids at most.
 */
export function digestMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    frequency: 'daily' | 'weekly';
    /** `2026-11-01` or `2026-10-26 – 2026-11-01` — local dates, locale-neutral. */
    periodLabel: string;
    /** `teams`: the reader leads teams and the figures are theirs alone. */
    scope: 'workspace' | 'teams';
    current: DigestMailFigures;
    previous: DigestMailFigures;
    /** The Reports screen, with the reader's team ids when `scope` is `teams`. */
    reportsUrl?: string;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const { current: c, previous: p } = input;
  const daily = input.frequency === 'daily';
  const none = '—';

  const wait = (seconds: number | null): string =>
    seconds === null ? none : durationText(ctx.locale, seconds);
  const percent = (score: number | null): string =>
    score === null ? none : t ? `%${Math.round(score * 100)}` : `${Math.round(score * 100)}%`;
  const ratings =
    c.csat_responses === 0
      ? ''
      : t
        ? ` (${c.csat_responses} oy)`
        : ` (${c.csat_responses} ${c.csat_responses === 1 ? 'rating' : 'ratings'})`;
  const count = (label: string, value: number, before: number): readonly [string, string] => [
    label,
    `${value}${changeText(ctx.locale, 'count', value, before)}`,
  ];

  const rows: Array<readonly [string, string]> = [
    count(t ? 'Sohbet' : 'Chats', c.chats, p.chats),
    count(t ? 'Kaçan sohbet' : 'Missed chats', c.missed, p.missed),
    [
      t ? 'İlk yanıt (ortalama)' : 'First reply (average)',
      `${wait(c.avg_first_response_seconds)}${changeText(ctx.locale, 'seconds', c.avg_first_response_seconds, p.avg_first_response_seconds)}`,
    ],
    [
      t ? 'Memnuniyet' : 'Satisfaction',
      `${percent(c.csat_score)}${ratings}${changeText(ctx.locale, 'points', c.csat_score, p.csat_score)}`,
    ],
    count(t ? 'AI çözdü' : 'Resolved by AI', c.ai_resolved, p.ai_resolved),
    count(t ? 'AI devretti' : 'Handed over by AI', c.ai_handed_off, p.ai_handed_off),
    count(
      t ? 'Risk bayraklı sohbet' : 'Chats with a risk flag',
      c.risk_flagged_chats,
      p.risk_flagged_chats,
    ),
    [
      t ? 'Kuyrukta bekleme (80. yüzdelik)' : 'Queue wait (80th percentile)',
      `${wait(c.queue_p80_wait_seconds)}${changeText(ctx.locale, 'seconds', c.queue_p80_wait_seconds, p.queue_p80_wait_seconds)}`,
    ],
  ];

  const lead = daily
    ? t
      ? `${input.workspaceName} için ${input.periodLabel} günü. Parantez içindeki değişim, bir önceki güne göredir.`
      : `${input.workspaceName} for ${input.periodLabel}. The change in brackets is against the day before.`
    : t
      ? `${input.workspaceName} için ${input.periodLabel} haftası. Parantez içindeki değişim, bir önceki haftaya göredir.`
      : `${input.workspaceName} for the week ${input.periodLabel}. The change in brackets is against the week before.`;

  const blocks: EmailBlock[] = [{ type: 'paragraph', text: lead }];
  if (input.scope === 'teams') {
    blocks.push({
      type: 'note',
      text: t
        ? 'Bu özet yalnızca liderlik ettiğiniz ekiplerin sayılarını içerir.'
        : 'This summary covers only the teams you lead.',
    });
  }
  blocks.push({ type: 'facts', rows });
  if (input.reportsUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Raporları aç' : 'Open reports',
      url: input.reportsUrl,
      fallback: fallback(ctx),
    });
  }

  const kind = daily
    ? t
      ? 'Günlük özet'
      : 'Daily summary'
    : t
      ? 'Haftalık özet'
      : 'Weekly summary';
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: `${kind}: ${input.workspaceName} · ${input.periodLabel}`,
    preheader: t
      ? `${c.chats} sohbet, ${c.missed} kaçan, ${c.risk_flagged_chats} risk bayraklı.`
      : `${c.chats} chats, ${c.missed} missed, ${c.risk_flagged_chats} with a risk flag.`,
    icon: ICON.chart,
    heading: kind,
    blocks,
    footer: [
      t
        ? `Bu e-postayı, ${input.workspaceName} çalışma alanında ${daily ? 'günlük' : 'haftalık'} özet sizin için açık olduğu için aldınız. Panelde Ayarlar › Bildirimler bölümünden kapatabilirsiniz. Özette oyuncu bilgisi ya da mesaj metni yer almaz.`
        : `You received this email because the ${daily ? 'daily' : 'weekly'} summary is on for you in ${input.workspaceName}. Switch it off in the panel under Settings › Notifications. It carries no player details or message text.`,
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
/** A risk flag's type, in the mail's words (AI-27 · `RISK_FLAG_TYPES`). */
const RISK_FLAG_LABELS: Readonly<Record<string, { en: string; tr: string }>> = {
  rg_signal: { en: 'Responsible gaming signal', tr: 'Sorumlu oyun sinyali' },
  self_exclusion_request: { en: 'Self-exclusion request', tr: 'Kendini oyundan men talebi' },
  underage_suspected: { en: 'Suspected minor', tr: 'Reşit olmama şüphesi' },
  self_harm: { en: 'Self-harm', tr: 'Kendine zarar ifadesi' },
  complaint_formal: { en: 'Formal complaint', tr: 'Resmi şikâyet' },
  fraud_suspected: { en: 'Suspected fraud', tr: 'Dolandırıcılık şüphesi' },
  account_takeover_suspected: { en: 'Suspected account takeover', tr: 'Hesap ele geçirme şüphesi' },
  multi_account: { en: 'Multiple accounts', tr: 'Çoklu hesap' },
  abusive: { en: 'Abuse', tr: 'Hakaret / tehdit' },
  account_security: { en: 'Account security', tr: 'Hesap güvenliği' },
};

/**
 * An urgent risk flag was raised (tm 302.2 · AI-27-S4): self-harm, a suspected
 * minor, a self-exclusion request. Sent to the supervisors, the Responsible
 * Gaming team and the addresses the workspace chose — what was flagged and
 * where, never what the player wrote.
 */
export function riskFlagUrgentMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    type: string;
    /** The conversation (panel "Thread ID"); null once it is gone. */
    chatId: string | null;
    /** By the AI's guardrail, its risk signal, or a person. */
    raisedBy: 'ai' | 'agent';
    raisedAt: Date;
    timeZone: string;
    chatUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const label = RISK_FLAG_LABELS[input.type]?.[t ? 'tr' : 'en'] ?? input.type;
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.workspaceName} çalışma alanında bir konuşmaya acil risk bayrağı kondu. Konuşma bir yetkiliye devredildi; lütfen hemen ilgilenin.`
        : `A conversation in ${input.workspaceName} was given an urgent risk flag. It has been handed to a person; please look at it now.`,
    },
    {
      type: 'facts',
      rows: [
        [t ? 'Bayrak' : 'Flag', label],
        [
          t ? 'Koyan' : 'Raised by',
          input.raisedBy === 'ai' ? (t ? 'Yapay zekâ' : 'The AI') : t ? 'Temsilci' : 'An agent',
        ],
        ...(input.chatId ? [['Thread ID', input.chatId] as [string, string]] : []),
        [
          t ? 'Zaman' : 'When',
          `${formatDateTime(input.raisedAt, ctx.locale, input.timeZone)} ${zoneLabel(input.timeZone)}`,
        ],
      ],
    },
  ];
  if (input.chatUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Konuşmayı aç' : 'Open the conversation',
      url: input.chatUrl,
      fallback: fallback(ctx),
    });
  }
  blocks.push({
    type: 'note',
    text: t
      ? 'Oyuncunun yazdıkları bu e-postada yer almaz; ayrıntılar yalnız panelde, yetkili kişilere görünür.'
      : 'Nothing the player wrote is in this email; the details are in the panel, for the people entitled to them.',
  });
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t ? `SiyahTuş: acil risk bayrağı — ${label}` : `SiyahTuş: urgent risk flag — ${label}`,
    preheader: t ? 'Bir konuşma acil ilgi bekliyor.' : 'A conversation needs attention now.',
    icon: ICON.alarm,
    tone: 'alert',
    heading: t ? 'Acil risk bayrağı' : 'Urgent risk flag',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanında acil risk bayraklarının alıcısı olduğunuz için aldınız.'
        : 'You received this email because you receive urgent risk flags for this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * A QA review found that the AI did not hand over when a compliance rule
 * required it (tm 319.2 · AI-24 §4): sent to the workspace's administrators.
 * Which conversation and which criteria — never what the player wrote.
 */
export function qaMandatoryHandoffViolationMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    /** The connection (panel "Chat ID"). */
    threadId: string;
    failed: readonly string[];
    reviewedAt: Date;
    timeZone: string;
    reviewUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.workspaceName} çalışma alanında bir kalite incelemesi, yapay zekânın zorunlu bir devri zamanında yapmadığını tespit etti. Bir öneri ve bir test senaryosu taslağı açıldı.`
        : `A quality review in ${input.workspaceName} found that the AI did not hand over when a compliance rule required it. A suggestion and a test scenario draft were opened.`,
    },
    {
      type: 'facts',
      rows: [
        ['Chat ID', input.threadId],
        [t ? 'Kriterler' : 'Criteria', input.failed.join(', ')],
        [
          t ? 'İnceleme' : 'Reviewed',
          `${formatDateTime(input.reviewedAt, ctx.locale, input.timeZone)} ${zoneLabel(input.timeZone)}`,
        ],
      ],
    },
  ];
  if (input.reviewUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'İncelemeyi aç' : 'Open the review',
      url: input.reviewUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? 'SiyahTuş: zorunlu devir ihlali — kalite incelemesi'
      : 'SiyahTuş: mandatory hand-over missed — quality review',
    preheader: t ? 'Yapay zekâ zorunlu bir devri kaçırdı.' : 'The AI missed a mandatory hand-over.',
    icon: ICON.alarm,
    tone: 'alert',
    heading: t ? 'Zorunlu devir ihlali' : 'Mandatory hand-over missed',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının yöneticisi olduğunuz için aldınız.'
        : 'You received this email because you administer this workspace.',
      signature(ctx),
    ],
  });
}

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
 * The structured knowledge tables' stale-row digest (tm 310.5 · AI-13-S2): one
 * mail per workspace per sweep that found rows newly due for review, naming at
 * most ten of them. The AI keeps using a stale row — the mail only asks for a
 * look.
 */
export function knowledgeStaleMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    /** How many rows fell due, per table label, in the order given. */
    groups: Array<{ label: string; count: number }>;
    /** Up to ten row names, as the workspace wrote them. */
    sample: string[];
    total: number;
    tablesUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.workspaceName} çalışma alanında ${input.total} bilgi tablosu satırının gözden geçirme zamanı geldi. Yapay zekâ bu satırları kullanmaya devam ediyor; bilgilerin hâlâ doğru olduğunu doğrulayın.`
        : `${input.total} rows of ${input.workspaceName}'s knowledge tables are due for review. The AI keeps using them; please confirm they are still correct.`,
    },
    { type: 'facts', rows: input.groups.map((group) => [group.label, String(group.count)]) },
  ];
  if (input.sample.length > 0) {
    blocks.push({
      type: 'paragraph',
      text: input.sample.join(', ') + (input.total > input.sample.length ? '…' : ''),
    });
  }
  if (input.tablesUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Tabloları aç' : 'Open the tables',
      url: input.tablesUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `SiyahTuş: ${input.total} bilgi satırı gözden geçirme bekliyor`
      : `SiyahTuş: ${input.total} knowledge rows are due for review`,
    preheader: t
      ? 'Yapay zekâ eski satırları kullanmaya devam ediyor.'
      : 'The AI keeps using the old rows.',
    icon: ICON.alarm,
    tone: 'brand',
    heading: t ? 'Gözden geçirme zamanı geldi' : 'Rows are due for review',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının sahibi, yardımcı sahibi ya da yöneticisi olduğunuz için aldınız.'
        : 'You received this email because you are an owner, vice-owner or admin of this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * A live channel the provider stopped accepting (tm 380 · KN-01): Meta refused
 * the WhatsApp business token (Graph error 190 — expired, revoked, a password
 * change). Replies on it stop until someone reconnects it in Settings →
 * Channels. Sent once per lapse to the workspace's owners, vice-owners and
 * admins; no customer, number or message in it.
 */
export function channelReconnectMail(
  ctx: MailContext,
  input: { workspaceName: string; channelName: string; channelsUrl: string | null },
): RenderedEmail {
  const t = tr(ctx.locale);
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.workspaceName} çalışma alanının ${input.channelName} kanalı artık mesaj gönderemiyor: sağlayıcı bağlantı yetkisini geri çevirdi. Gelen mesajlar yine de alınır; ajan yanıtları kanal yeniden bağlanana kadar müşteriye ulaşmaz.`
        : `${input.workspaceName}'s ${input.channelName} channel can no longer send: the provider refused its connection. Incoming messages are still taken in; agent replies do not reach the customer until the channel is reconnected.`,
    },
  ];
  if (input.channelsUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Kanalı yeniden bağla' : 'Reconnect the channel',
      url: input.channelsUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `SiyahTuş: ${input.channelName} kanalını yeniden bağlayın`
      : `SiyahTuş: reconnect ${input.channelName}`,
    preheader: t
      ? 'Ajan yanıtları kanal yeniden bağlanana kadar gitmez.'
      : 'Agent replies do not go out until it is reconnected.',
    icon: ICON.alarm,
    tone: 'brand',
    heading: t ? 'Kanalın yeniden bağlanması gerekiyor' : 'A channel needs reconnecting',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının sahibi, yardımcı sahibi ya da yöneticisi olduğunuz için aldınız.'
        : 'You received this email because you are an owner, vice-owner or admin of this workspace.',
      signature(ctx),
    ],
  });
}

/**
 * A scheduled AI configuration publication the system refused at its time
 * (tm 316.6 · AI-20-S4): the approval, the compliance pack or the base no
 * longer held, so the version was rejected instead of going live. Sent to the
 * person who submitted it and the one who approved it.
 */
export function aiConfigScheduleRefusedMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    agentName: string;
    /** The version as the panel names it ("v12"). */
    label: string;
    reason: 'approval_lapsed' | 'compliance_pack' | 'stale_base';
    versionsUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const why = {
    approval_lapsed: t
      ? 'Onaylayan kişi bu sürümü artık yayınlayamıyor (çalışma alanından ayrıldı, askıya alındı ya da yetkisi değişti).'
      : 'The person who approved it can no longer publish it (they left the workspace, were suspended or lost the right).',
    compliance_pack: t
      ? 'Sürümün geçtiği uyum paketi artık güncel değil.'
      : 'The compliance pack it passed is no longer current.',
    stale_base: t
      ? 'Gönderildikten sonra aynı ayarları değiştiren başka bir sürüm yayınlandı.'
      : 'Another version changing the same settings went live after it was submitted.',
  }[input.reason];
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.agentName} için ${input.label} zamanı geldiğinde yayınlanmadı ve reddedildi. Yapay zekâ yayındaki sürümle cevap vermeye devam ediyor.`
        : `${input.label} of ${input.agentName} was not published at its time and has been rejected. The AI keeps answering with the version that is live.`,
    },
    { type: 'paragraph', text: why },
    {
      type: 'paragraph',
      text: t ? 'Taslağı yeniden onaya gönderin.' : 'Send the draft for review again.',
    },
  ];
  if (input.versionsUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'Sürümleri aç' : 'Open the versions',
      url: input.versionsUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `SiyahTuş: ${input.agentName} ${input.label} yayınlanmadı`
      : `SiyahTuş: ${input.agentName} ${input.label} was not published`,
    preheader: t
      ? 'Zamanlanmış yayın yapılmadı; yayındaki sürüm değişmedi.'
      : 'The scheduled publication did not happen; the live version is unchanged.',
    icon: ICON.alarm,
    tone: 'alert',
    heading: t ? 'Zamanlanmış yayın yapılmadı' : 'Scheduled publication refused',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu sürümü gönderdiğiniz ya da onayladığınız için aldınız.'
        : 'You received this email because you submitted or approved this version.',
      signature(ctx),
    ],
  });
}

/**
 * The permission matrix's names, for the mail that says what moved (tm 325.2).
 * Keyed by the catalogue's own type, so a capability added to `CAPABILITIES`
 * does not compile until its mail says what it is.
 */
const CAPABILITY_LABELS: Record<CapabilityKey, { en: string; tr: string }> = {
  'chats.view': { en: 'View chats', tr: 'Sohbetleri görme' },
  'chats.takeover': { en: 'Take over a chat', tr: 'Sohbeti devralma' },
  'timeline.view': { en: "View a chat's timeline", tr: 'Sohbetin zaman çizelgesini görme' },
  'ratings.view': {
    en: "See players' ratings and comments",
    tr: 'Oyuncu puanlarını ve yorumlarını görme',
  },
  'transcripts.export': {
    en: "Download, print and mail a chat's transcript",
    tr: 'Sohbet dökümünü indirme, yazdırma ve gönderme',
  },
  'tickets.view': { en: 'View tickets', tr: 'Talepleri görme' },
  'customers.contact.view': {
    en: "See a player's email and username",
    tr: 'Oyuncunun e-postasını ve kullanıcı adını görme',
  },
  'customers.edit': { en: 'Edit player records', tr: 'Oyuncu kayıtlarını düzenleme' },
  'customers.ban': { en: 'Ban players', tr: 'Oyuncu engelleme' },
  'customers.erase': { en: "Erase a player's data", tr: 'Oyuncu verisini silme' },
  'customers.documents.view': {
    en: 'Open sensitive documents a player e-mailed',
    tr: 'Oyuncunun e-postayla gönderdiği hassas belgeleri açma',
  },
  'ai.manage': { en: 'Configure the AI Agent', tr: "AI Agent'ı yapılandırma" },
  'ai.guardrails.edit': { en: 'Edit AI compliance rules', tr: 'AI uyum kurallarını düzenleme' },
  'ai.config.publish': {
    en: 'Approve and publish AI settings',
    tr: 'AI ayarlarını onaylama ve yayımlama',
  },
  'ai.suggest': { en: 'Suggest corrections to the AI', tr: "AI'a düzeltme önerme" },
  'ai.suggestions.review': { en: 'Review AI suggestions', tr: 'AI önerilerini inceleme' },
  'ai.qa.review': { en: 'Review AI quality', tr: 'AI kalite incelemesi' },
  'reports.view': { en: 'View reports', tr: 'Raporları görme' },
  'reports.schedule': { en: 'Schedule report emails', tr: 'Rapor e-postalarını zamanlama' },
  'team.invite': { en: 'Invite teammates', tr: 'Ekip arkadaşı davet etme' },
  'team.members.manage': { en: "Manage members' roles", tr: 'Üyelerin rolünü yönetme' },
  'team.groups.manage': { en: 'Manage teams', tr: 'Ekipleri yönetme' },
  'settings.security': { en: 'Security settings', tr: 'Güvenlik ayarları' },
  'settings.company': { en: 'Company and appearance', tr: 'Şirket ve görünüm' },
  'settings.brands': { en: 'Brands', tr: 'Markalar' },
  'settings.channels': { en: 'Channels', tr: 'Kanallar' },
  'settings.webhooks': { en: 'Webhooks', tr: "Webhook'lar" },
  'settings.tags': { en: 'Tags', tr: 'Etiketler' },
  'settings.canned_responses': { en: 'Canned responses', tr: 'Hazır yanıtlar' },
  'settings.sso': { en: 'Single sign-on', tr: 'Tek oturum açma (SSO)' },
  'settings.permissions': { en: 'Change permissions', tr: 'İzinleri değiştirme' },
  'billing.manage': { en: 'Manage billing', tr: 'Faturalamayı yönetme' },
  'logs.audit.view': { en: 'View the audit log', tr: 'Denetim kaydını görme' },
  'logs.audit.export': { en: 'Stream the audit log (SIEM)', tr: 'Denetim kaydını aktarma (SIEM)' },
  'timeline.export': {
    en: "Export a chat's timeline (masked)",
    tr: 'Zaman çizelgesini dışa aktarma (maskeli)',
  },
  'timeline.export_unmasked': {
    en: "Export a chat's timeline unmasked",
    tr: 'Zaman çizelgesini maskesiz dışa aktarma',
  },
};

const MATRIX_ROLE_LABELS: Record<MatrixRole, { en: string; tr: string }> = {
  owner: { en: 'Owner', tr: 'Kurucu' },
  admin: { en: 'Admin', tr: 'Yönetici' },
  team_lead: { en: 'Team Lead', tr: 'Ekip Lideri' },
  agent: { en: 'Agent', tr: 'Ekip Üyesi' },
};

const CAPABILITY_VALUE_LABELS: Record<CapabilityValue, { en: string; tr: string }> = {
  off: { en: 'Off', tr: 'Kapalı' },
  on: { en: 'On', tr: 'Açık' },
  none: { en: 'None', tr: 'Yok' },
  own: { en: 'Own', tr: 'Kendi' },
  team: { en: 'Team', tr: 'Ekip' },
  all: { en: 'All', tr: 'Tümü' },
};

/** Cells named in the mail; the rest is a count and the audit log. */
const PERMISSION_MAIL_ROWS = 20;

/**
 * The Founder changed who may do what (RL-02-S5): every Yönetici is told what
 * moved and why, so a widened reach is never a surprise found later in the
 * audit log.
 */
export function permissionsChangedMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    actorName: string;
    changes: ReadonlyArray<{
      role: MatrixRole;
      capability: CapabilityKey;
      from: CapabilityValue;
      to: CapabilityValue;
    }>;
    reason: string;
    matrixUrl: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const label = (names: { en: string; tr: string }): string => (t ? names.tr : names.en);
  const rows = input.changes
    .slice(0, PERMISSION_MAIL_ROWS)
    .map(
      (change) =>
        [
          `${label(MATRIX_ROLE_LABELS[change.role])} · ${label(CAPABILITY_LABELS[change.capability])}`,
          `${label(CAPABILITY_VALUE_LABELS[change.from])} → ${label(CAPABILITY_VALUE_LABELS[change.to])}`,
        ] as const,
    );
  const count = input.changes.length;
  const blocks: EmailBlock[] = [
    {
      type: 'paragraph',
      text: t
        ? `${input.actorName}, ${input.workspaceName} çalışma alanında rollerin yetkilerini değiştirdi (${count} değişiklik). Değişiklik, oturumlara bir dakika içinde, yeniden giriş gerekmeden yansır.`
        : `${input.actorName} changed what roles may do in ${input.workspaceName} (${count} ${count === 1 ? 'change' : 'changes'}). Sessions pick it up within a minute, without signing in again.`,
    },
    { type: 'facts', rows },
  ];
  if (count > rows.length) {
    blocks.push({
      type: 'note',
      text: t
        ? `ve ${count - rows.length} değişiklik daha — tamamı denetim kaydında.`
        : `and ${count - rows.length} more — all of them are in the audit log.`,
    });
  }
  blocks.push({
    type: 'callout',
    text: `${t ? 'Gerekçe' : 'Reason'}: ${input.reason}`,
  });
  if (input.matrixUrl) {
    blocks.push({
      type: 'button',
      label: t ? 'İzinleri aç' : 'Open permissions',
      url: input.matrixUrl,
      fallback: fallback(ctx),
    });
  }
  return renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    eyebrow: input.workspaceName,
    subject: t
      ? `SiyahTuş: ${input.workspaceName} çalışma alanında izinler değişti`
      : `SiyahTuş: permissions changed in ${input.workspaceName}`,
    preheader: t
      ? 'Hangi rolün neye erişebildiği değişti.'
      : 'What each role may reach has changed.',
    icon: ICON.lock,
    heading: t ? 'İzinler değişti' : 'Permissions changed',
    blocks,
    footer: [
      t
        ? 'Bu e-postayı, bu çalışma alanının yöneticisi olduğunuz için aldınız.'
        : 'You received this email because you are an admin of this workspace.',
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

/**
 * An agent's reply on a ticket, to its player (tm 356.3 · HD-01).
 *
 * The reply alone: the text the agent wrote (already masked), never the
 * conversation before it — quoting would put earlier messages back in front of
 * whoever reads this inbox, including ones the player may have written from a
 * shared address, and the thread is what `In-Reply-To` / `References` are for.
 * `[#<id>]` leads the subject so the player's answer can be told to belong to
 * this ticket by eye and by the inbound path (HD-03) alike.
 */
export function ticketReplyMail(
  ctx: MailContext,
  input: {
    workspaceName: string;
    ticketId: string;
    ticketSubject: string;
    body: string;
    agentName: string | null;
  },
): RenderedEmail {
  const t = tr(ctx.locale);
  const subject = `[#${input.ticketId}] ${input.ticketSubject}`;
  const rendered = renderEmail({
    locale: ctx.locale,
    homeUrl: ctx.appUrl ?? '',
    sender: input.workspaceName,
    eyebrow: input.workspaceName,
    subject,
    preheader: firstLine(input.body),
    heading: input.ticketSubject,
    blocks: [{ type: 'verbatim', text: input.body }],
    footer: [
      ...(input.agentName ? [`${input.agentName} · ${input.workspaceName}`] : []),
      t
        ? `Bu e-postayı, ${input.workspaceName} ile açık bir talebiniz (#${input.ticketId}) olduğu için aldınız.`
        : `You received this email because you have a request (#${input.ticketId}) open with ${input.workspaceName}.`,
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
export function zoneSentence(locale: MailLocale, timeZone: string): string {
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
