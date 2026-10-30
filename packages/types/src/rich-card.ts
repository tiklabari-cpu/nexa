/**
 * The rich card (EN-02 · tm 353): a title, an image, a short body and up to
 * five buttons. A campaign can be one, and the same shape is a `rich_message`
 * event in a conversation — what an AI or a bot sends with quick-reply
 * buttons.
 *
 * Three button actions:
 *   - `send_message` — the button's label goes into the conversation as the
 *     player's own message (with `properties.postback` saying which button),
 *     so the AI and routing read it exactly as if it had been typed.
 *   - `open_url`     — opens an `https:` address in a new tab.
 *   - `copy_coupon`  — copies a code to the clipboard.
 *
 * Who may use what (EN-02 karar 1, G9/G10): a campaign may use all three. A
 * card in a conversation — sent by the AI, a bot or the API — may only send a
 * message or open an address on one of the workspace's trusted domains; a
 * coupon is a campaign's business, never the AI's.
 *
 * Every card has a plain-text twin (`richCardFallbackText`): a channel that
 * cannot draw a card gets the title, the body and the buttons numbered.
 * Nothing is cut short to fit: a label one character too long is refused with
 * the limit, never truncated behind the author's back.
 */

export const RICH_CARD_TITLE_MAX = 80;
export const RICH_CARD_BODY_MAX = 220;
export const RICH_CARD_BUTTONS_MAX = 5;
export const CARD_BUTTON_LABEL_MAX = 20;
export const CARD_COUPON_CODE_MAX = 40;
export const CARD_URL_MAX = 2048;
export const CARD_IMAGE_ALT_MAX = 150;

export const CARD_BUTTON_STYLES = ['default', 'primary'] as const;
export type CardButtonStyle = (typeof CARD_BUTTON_STYLES)[number];

export const CARD_ACTION_TYPES = ['send_message', 'open_url', 'copy_coupon'] as const;
export type CardActionType = (typeof CARD_ACTION_TYPES)[number];

/** The actions a card in a conversation may carry (AI, bots, the API). */
export const CONVERSATION_CARD_ACTION_TYPES = ['send_message', 'open_url'] as const;

export type CardAction =
  | { type: 'send_message' }
  | { type: 'open_url'; url: string }
  | { type: 'copy_coupon'; code: string };

export interface CardButton {
  label: string;
  style: CardButtonStyle;
  action: CardAction;
}

export interface RichCardImage {
  /** `https:`, or a file this workspace uploaded (`/api/v1/uploads/<key>`). */
  url: string;
  /** Required: what a screen reader says instead (WCAG 1.1.1). */
  alt: string;
}

export interface RichCard {
  title?: string;
  body: string;
  image?: RichCardImage;
  buttons: CardButton[];
}

/** A host the workspace trusts, as settings stores it (`trusted_domains`). */
export interface CardTrustedHost {
  domain: string;
  include_subdomains: boolean;
}

/**
 * Where the card goes. A campaign may use every action; a conversation only
 * `CONVERSATION_CARD_ACTION_TYPES`, and its links only to `trustedHosts`.
 */
export type RichCardPolicy =
  { source: 'campaign' } | { source: 'conversation'; trustedHosts: readonly CardTrustedHost[] };

export const RICH_CARD_PROBLEM_CODES = [
  'not_a_card',
  'title_too_long',
  'body_required',
  'body_too_long',
  'image_url',
  'image_alt_required',
  'image_alt_too_long',
  'buttons_too_many',
  'label_required',
  'label_too_long',
  'style',
  'action',
  'action_not_allowed',
  'url',
  'url_not_trusted',
  'coupon_required',
  'coupon_too_long',
] as const;
export type RichCardProblemCode = (typeof RICH_CARD_PROBLEM_CODES)[number];

export interface RichCardProblem {
  /** Where: `title`, `image.url`, `buttons[2].action.url` … */
  field: string;
  code: RichCardProblemCode;
}

/** An upload of this workspace, as `/uploads` hands back its `file_url`. */
const UPLOAD_PATH = /^\/api\/v1\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Whether `url` is an address a card may link to: `https:` only — no
 * `javascript:`, `data:` or plain `http:` — with no user name or password in
 * it, at most `CARD_URL_MAX` characters.
 */
export function isCardLink(url: string): boolean {
  if (url.length === 0 || url.length > CARD_URL_MAX || url !== url.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
}

/** Whether `url` may be a card's image: an `https:` address or this workspace's upload path. */
export function isCardImageUrl(url: string): boolean {
  return isCardLink(url) || UPLOAD_PATH.test(url);
}

/** Whether an upload path (rather than an address) names the image — the server checks it is ours. */
export function isCardUploadPath(url: string): boolean {
  return UPLOAD_PATH.test(url);
}

/**
 * Whether `url`'s host is one the workspace trusts: the domain itself, or — for
 * a domain that includes subdomains — anything ending in `.<domain>` (anchored
 * at the dot, so `evil-example.com` is not `example.com`'s). The same rule the
 * widget's mint applies (`auth_resolve_widget_origin`).
 */
export function isTrustedCardLink(url: string, trustedHosts: readonly CardTrustedHost[]): boolean {
  if (!isCardLink(url)) return false;
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  return trustedHosts.some(
    (trusted) =>
      host === trusted.domain ||
      (trusted.include_subdomains && host.endsWith(`.${trusted.domain}`)),
  );
}

/** A fresh action of `type`: switching a button's action never carries the old value over. */
export function emptyCardAction(type: CardActionType): CardAction {
  if (type === 'open_url') return { type, url: '' };
  if (type === 'copy_coupon') return { type, code: '' };
  return { type };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The card as written, tidied: strings trimmed, an empty title or image
 * dropped, a missing style `default`. Not a validation — `richCardProblems`
 * says what is wrong with the result; null only when it is not card-shaped at
 * all.
 */
export function normalizeRichCard(input: unknown): RichCard | null {
  if (!isRecord(input) || !Array.isArray(input['buttons'])) return null;
  const card: RichCard = { body: text(input['body']), buttons: [] };
  const title = text(input['title']);
  if (title) card.title = title;
  const image = input['image'];
  if (isRecord(image) && (text(image['url']) || text(image['alt']))) {
    card.image = { url: text(image['url']), alt: text(image['alt']) };
  }
  for (const raw of input['buttons'] as unknown[]) {
    const button = isRecord(raw) ? raw : {};
    const action = isRecord(button['action']) ? button['action'] : {};
    const type = action['type'];
    card.buttons.push({
      label: text(button['label']),
      style: (button['style'] ?? 'default') as CardButtonStyle,
      action:
        type === 'open_url'
          ? { type, url: text(action['url']) }
          : type === 'copy_coupon'
            ? { type, code: text(action['code']) }
            : ({ type } as CardAction),
    });
  }
  return card;
}

/**
 * Everything wrong with `card` under `policy`, in reading order; empty when it
 * may be saved and sent. Run on the card `normalizeRichCard` returned.
 */
export function richCardProblems(card: RichCard | null, policy: RichCardPolicy): RichCardProblem[] {
  if (!card) return [{ field: 'card', code: 'not_a_card' }];
  const problems: RichCardProblem[] = [];
  const push = (field: string, code: RichCardProblemCode): void => {
    problems.push({ field, code });
  };

  if (card.title !== undefined && card.title.length > RICH_CARD_TITLE_MAX) {
    push('title', 'title_too_long');
  }
  if (!card.body) push('body', 'body_required');
  else if (card.body.length > RICH_CARD_BODY_MAX) push('body', 'body_too_long');

  if (card.image) {
    if (!isCardImageUrl(card.image.url)) push('image.url', 'image_url');
    if (!card.image.alt) push('image.alt', 'image_alt_required');
    else if (card.image.alt.length > CARD_IMAGE_ALT_MAX) push('image.alt', 'image_alt_too_long');
  }

  if (card.buttons.length > RICH_CARD_BUTTONS_MAX) push('buttons', 'buttons_too_many');
  card.buttons.forEach((button, index) => {
    const at = `buttons[${index}]`;
    if (!button.label) push(`${at}.label`, 'label_required');
    else if (button.label.length > CARD_BUTTON_LABEL_MAX) push(`${at}.label`, 'label_too_long');
    if (!(CARD_BUTTON_STYLES as readonly unknown[]).includes(button.style)) {
      push(`${at}.style`, 'style');
    }
    const action = button.action;
    if (!(CARD_ACTION_TYPES as readonly unknown[]).includes(action.type)) {
      push(`${at}.action`, 'action');
      return;
    }
    if (
      policy.source === 'conversation' &&
      !(CONVERSATION_CARD_ACTION_TYPES as readonly string[]).includes(action.type)
    ) {
      push(`${at}.action`, 'action_not_allowed');
      return;
    }
    if (action.type === 'open_url') {
      if (!isCardLink(action.url)) push(`${at}.action.url`, 'url');
      else if (
        policy.source === 'conversation' &&
        !isTrustedCardLink(action.url, policy.trustedHosts)
      ) {
        push(`${at}.action.url`, 'url_not_trusted');
      }
    } else if (action.type === 'copy_coupon') {
      if (!action.code) push(`${at}.action.code`, 'coupon_required');
      else if (action.code.length > CARD_COUPON_CODE_MAX)
        push(`${at}.action.code`, 'coupon_too_long');
    }
  });
  return problems;
}

/** One sentence per problem, for an API error: `buttons[1].action.url: …`. */
export function describeRichCardProblem(problem: RichCardProblem): string {
  const words: Record<RichCardProblemCode, string> = {
    not_a_card: 'is not a card (title, body, image, buttons)',
    title_too_long: `is longer than ${RICH_CARD_TITLE_MAX} characters`,
    body_required: 'is required',
    body_too_long: `is longer than ${RICH_CARD_BODY_MAX} characters`,
    image_url: 'must be an https: address or a file uploaded to this workspace',
    image_alt_required: 'is required — describe the image',
    image_alt_too_long: `is longer than ${CARD_IMAGE_ALT_MAX} characters`,
    buttons_too_many: `holds more than ${RICH_CARD_BUTTONS_MAX} buttons`,
    label_required: 'is required',
    label_too_long: `is longer than ${CARD_BUTTON_LABEL_MAX} characters`,
    style: `must be one of ${CARD_BUTTON_STYLES.join(', ')}`,
    action: `must be one of ${CARD_ACTION_TYPES.join(', ')}`,
    action_not_allowed: `may only be ${CONVERSATION_CARD_ACTION_TYPES.join(' or ')} in a conversation`,
    url: 'must be an https: address',
    url_not_trusted: "must be on one of the workspace's trusted domains",
    coupon_required: 'is required',
    coupon_too_long: `is longer than ${CARD_COUPON_CODE_MAX} characters`,
  };
  return `${problem.field}: ${words[problem.code]}.`;
}

/**
 * The card in plain text, for a channel that cannot draw one (and the widget
 * that predates cards): the title, the body, then each button numbered — with
 * its address or code, so the reader can still act on it.
 */
export function richCardFallbackText(card: RichCard): string {
  const lines: string[] = [];
  if (card.title) lines.push(card.title);
  lines.push(card.body);
  card.buttons.forEach((button, index) => {
    const action = button.action;
    const detail =
      action.type === 'open_url'
        ? `: ${action.url}`
        : action.type === 'copy_coupon'
          ? `: ${action.code}`
          : '';
    lines.push(`${index + 1}. ${button.label}${detail}`);
  });
  return lines.join('\n');
}

/**
 * The card an event or a postback carries, or null — for readers (the Inbox),
 * which draw only what still passes the campaign rules' shape checks.
 */
export function readRichCard(value: unknown): RichCard | null {
  const card = normalizeRichCard(value);
  return card && richCardProblems(card, { source: 'campaign' }).length === 0 ? card : null;
}

/**
 * What a `send_message` press says about itself on the player's message
 * (`properties.postback`): the button, its label, and either the campaign whose
 * card it was on — with the card as it was then, so the Inbox can draw it — or
 * the `rich_message` event in the conversation.
 */
export type CardPostback =
  | {
      source: 'campaign';
      campaign_id: string;
      button: number;
      label: string;
      card: RichCard;
    }
  | { source: 'event'; event_id: string; button: number; label: string };

/** The postback a message carries, or null. */
export function readCardPostback(properties: unknown): CardPostback | null {
  if (!isRecord(properties) || !isRecord(properties['postback'])) return null;
  const postback = properties['postback'];
  const button = postback['button'];
  const label = postback['label'];
  if (typeof button !== 'number' || typeof label !== 'string') return null;
  if (postback['source'] === 'campaign' && typeof postback['campaign_id'] === 'string') {
    const card = readRichCard(postback['card']);
    return card
      ? { source: 'campaign', campaign_id: postback['campaign_id'], button, label, card }
      : null;
  }
  if (postback['source'] === 'event' && typeof postback['event_id'] === 'string') {
    return { source: 'event', event_id: postback['event_id'], button, label };
  }
  return null;
}
