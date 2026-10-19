/**
 * Sensitive data in a conversation — the catalogue, who it is masked for, and
 * what the player is told (tm 300 · SiyahTuş analysis AI-26 · guardrail G11).
 *
 * A player in a panic ("param yatmadı!") can type anything: a password, the
 * SMS code a fraudster asked for, a card with its CVV, a wallet's seed phrase.
 * Whatever reaches the database, a log, a backup or the language model stays
 * there, so the API masks these values at write time (`lib/sensitive-mask.ts`)
 * and the original is never stored anywhere.
 *
 * The policy is per author (AI-26-S2). A player's message is masked for every
 * type. A staff or bot message is masked for the account secrets only — an
 * agent in this market legitimately sends a player the IBAN to deposit to, so
 * an IBAN in a staff message stays whole; the AI never sends one itself (AI-08).
 */

/** The eight kinds of value the masker detects (AI-26). */
export const SENSITIVE_TYPES = [
  'card',
  'cvv',
  'otp',
  'password',
  'iban',
  'seed_phrase',
  'private_key',
  'banking_credential',
] as const;
export type SensitiveType = (typeof SENSITIVE_TYPES)[number];

/** Who wrote the text being masked — the policy differs by author. */
export const SENSITIVE_AUTHORS = ['customer', 'agent', 'bot'] as const;
export type SensitiveAuthor = (typeof SENSITIVE_AUTHORS)[number];

/** The types masked in each author's text. */
export type SensitivePolicy = Readonly<Record<SensitiveAuthor, readonly SensitiveType[]>>;

/** What a staff member or the bot may never write in clear (AI-26-S2). */
const STAFF_MASKED: readonly SensitiveType[] = Object.freeze([
  'card',
  'cvv',
  'otp',
  'password',
  'seed_phrase',
  'private_key',
]);

/**
 * The default policy (AI-26-S2): everything in a player's message; the account
 * secrets in an agent's or the bot's — not the IBAN, and not a banking login
 * (which a staff message has no reason to quote back).
 */
export const DEFAULT_SENSITIVE_POLICY: SensitivePolicy = Object.freeze({
  customer: SENSITIVE_TYPES,
  agent: STAFF_MASKED,
  bot: STAFF_MASKED,
});

/**
 * The types that earn the player a warning (AI-26 §4): every secret. An IBAN
 * is masked but not warned about — sharing your own IBAN is how a withdrawal
 * gets matched, not a mistake.
 */
export const SENSITIVE_WARNING_TYPES: readonly SensitiveType[] = Object.freeze([
  'card',
  'cvv',
  'otp',
  'password',
  'seed_phrase',
  'private_key',
  'banking_credential',
]);

/**
 * The types that mean the player handed over a live account secret (AI-26 §5):
 * the AI is told `sensitive_shared` and answers "do not share this code with
 * anyone" (AI-08); AI-27 may suggest the account-security flag.
 */
export const SENSITIVE_SHARED_TYPES: readonly SensitiveType[] = Object.freeze(['password', 'otp']);

export function isSensitiveType(value: unknown): value is SensitiveType {
  return typeof value === 'string' && (SENSITIVE_TYPES as readonly string[]).includes(value);
}

/**
 * The types in `detected` that call for a warning, once each, in catalogue
 * order — what the write path puts in the warning event's `sensitive_types`.
 */
export function sensitiveWarningTypes(detected: Iterable<SensitiveType>): SensitiveType[] {
  const seen = new Set(detected);
  return SENSITIVE_TYPES.filter((type) => seen.has(type) && SENSITIVE_WARNING_TYPES.includes(type));
}

/** Whether `detected` includes a password or a one-time code (→ `sensitive_shared`). */
export function sharesAccountSecret(detected: Iterable<SensitiveType>): boolean {
  for (const type of detected) if (SENSITIVE_SHARED_TYPES.includes(type)) return true;
  return false;
}

/** The languages the warning is written in. */
export const SENSITIVE_WARNING_LANGUAGES = ['tr', 'en', 'ru', 'az', 'de', 'fr', 'es'] as const;
export type SensitiveWarningLanguage = (typeof SENSITIVE_WARNING_LANGUAGES)[number];

/**
 * The warning a player sees after sharing a secret (AI-26 §4). One text per
 * language for every type: it names the usual suspects and says the value was
 * hidden, which is true of whatever was found.
 */
export const SENSITIVE_WARNING_TEXTS: Readonly<Record<SensitiveWarningLanguage, string>> =
  Object.freeze({
    tr: 'Güvenliğiniz için şifre, SMS kodu veya kart bilgilerinizi paylaşmayın. Mesajınızdaki bu bilgiyi gizledik.',
    en: "For your security, please don't share passwords, SMS codes or card details. We have hidden this information in your message.",
    ru: 'В целях безопасности не сообщайте пароли, SMS-коды и данные карты. Мы скрыли эту информацию в вашем сообщении.',
    az: 'Təhlükəsizliyiniz üçün şifrə, SMS kodu və ya kart məlumatlarınızı paylaşmayın. Mesajınızdakı bu məlumatı gizlətdik.',
    de: 'Teilen Sie zu Ihrer Sicherheit keine Passwörter, SMS-Codes oder Kartendaten. Wir haben diese Angaben in Ihrer Nachricht ausgeblendet.',
    fr: 'Pour votre sécurité, ne partagez pas vos mots de passe, codes SMS ou données de carte. Nous avons masqué ces informations dans votre message.',
    es: 'Por su seguridad, no comparta contraseñas, códigos SMS ni datos de tarjeta. Hemos ocultado esta información en su mensaje.',
  });

/**
 * The warning in the player's language (`tr-TR` → `tr`), or in `fallback` when
 * the language is unknown or has no text — the warning is never skipped for
 * want of a translation.
 */
export function sensitiveWarningText(
  language: string | null | undefined,
  fallback: SensitiveWarningLanguage = 'tr',
): string {
  const primary =
    typeof language === 'string' ? (language.trim().toLowerCase().split(/[-_]/)[0] ?? '') : '';
  const known = (SENSITIVE_WARNING_LANGUAGES as readonly string[]).includes(primary);
  return SENSITIVE_WARNING_TEXTS[known ? (primary as SensitiveWarningLanguage) : fallback];
}
