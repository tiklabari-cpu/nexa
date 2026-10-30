import { describe, expect, it } from 'vitest';
import {
  RICH_CARD_BODY_MAX,
  describeRichCardProblem,
  emptyCardAction,
  isCardImageUrl,
  isCardLink,
  isTrustedCardLink,
  normalizeRichCard,
  readCardPostback,
  readRichCard,
  richCardFallbackText,
  richCardProblems,
  type RichCard,
  type RichCardPolicy,
} from './rich-card.js';

const card = (over: Partial<RichCard> = {}): RichCard => ({
  title: 'Deposit help',
  body: 'Stuck on a deposit? We can help.',
  image: { url: 'https://cdn.example.com/a.png', alt: 'A coin' },
  buttons: [
    { label: 'Get help', style: 'primary', action: { type: 'send_message' } },
    {
      label: 'Rules',
      style: 'default',
      action: { type: 'open_url', url: 'https://example.com/r' },
    },
    { label: 'Copy code', style: 'default', action: { type: 'copy_coupon', code: 'WELCOME50' } },
  ],
  ...over,
});
const codes = (value: RichCard, policy: RichCardPolicy = { source: 'campaign' }) =>
  richCardProblems(value, policy).map((p) => `${p.field}:${p.code}`);

describe('rich card links (EN-02)', () => {
  it('takes https only — javascript:, data:, http: and credentials are refused (FR-MOD-03.3.2)', () => {
    expect(isCardLink('https://example.com/a?b=c')).toBe(true);
    expect(isCardLink('javascript:alert(1)')).toBe(false);
    expect(isCardLink('JavaScript:alert(1)')).toBe(false);
    expect(isCardLink('data:text/html,<b>x</b>')).toBe(false);
    expect(isCardLink('http://example.com')).toBe(false);
    expect(isCardLink('https://user:pw@example.com')).toBe(false);
    expect(isCardLink(' https://example.com')).toBe(false);
    expect(isCardLink('/relative')).toBe(false);
  });

  it('takes an upload path as an image, and nothing else relative', () => {
    expect(isCardImageUrl('/api/v1/uploads/7-abc.png')).toBe(true);
    expect(isCardImageUrl('/api/v1/uploads/../secret')).toBe(false);
    expect(isCardImageUrl('/elsewhere/a.png')).toBe(false);
  });

  it('trusts a domain exactly, and its subdomains only when it says so, anchored at the dot', () => {
    const hosts = [
      { domain: 'example.com', include_subdomains: false },
      { domain: 'casino.test', include_subdomains: true },
    ];
    expect(isTrustedCardLink('https://example.com/x', hosts)).toBe(true);
    expect(isTrustedCardLink('https://www.example.com/x', hosts)).toBe(false);
    expect(isTrustedCardLink('https://pay.casino.test/x', hosts)).toBe(true);
    expect(isTrustedCardLink('https://evilcasino.test/x', hosts)).toBe(false);
    expect(isTrustedCardLink('javascript:alert(1)//example.com', hosts)).toBe(false);
  });
});

describe('richCardProblems (EN-02)', () => {
  it('accepts a title, an image and three buttons for a campaign (FR-MOD-03.3.2)', () => {
    expect(codes(card())).toEqual([]);
  });

  it('refuses a javascript: button and names the button', () => {
    const bad = card();
    bad.buttons[1] = {
      label: 'Rules',
      style: 'default',
      action: { type: 'open_url', url: 'javascript:alert(1)' },
    };
    expect(codes(bad)).toEqual(['buttons[1].action.url:url']);
  });

  it('refuses rather than cuts: a long label, body or coupon is a problem, never trimmed', () => {
    const bad = card({ body: 'x'.repeat(RICH_CARD_BODY_MAX + 1) });
    bad.buttons[0]!.label = 'x'.repeat(21);
    bad.buttons[2] = {
      label: 'Copy',
      style: 'default',
      action: { type: 'copy_coupon', code: 'c'.repeat(41) },
    };
    expect(codes(bad)).toEqual([
      'body:body_too_long',
      'buttons[0].label:label_too_long',
      'buttons[2].action.code:coupon_too_long',
    ]);
    // Exactly at the limit is fine.
    expect(codes(card({ body: 'x'.repeat(RICH_CARD_BODY_MAX) }))).toEqual([]);
  });

  it('wants a body, an alt text for an image, at most five buttons', () => {
    const six = Array.from({ length: 6 }, () => card().buttons[0]!);
    expect(
      codes(card({ body: '', image: { url: 'https://x.test/a.png', alt: '' }, buttons: six })),
    ).toEqual(['body:body_required', 'image.alt:image_alt_required', 'buttons:buttons_too_many']);
  });

  it('in a conversation: no coupon, and links only to trusted domains (EN-02 karar 1)', () => {
    const policy = {
      source: 'conversation',
      trustedHosts: [{ domain: 'example.com', include_subdomains: false }],
    } as const;
    expect(codes(card(), policy)).toEqual(['buttons[2].action:action_not_allowed']);
    const elsewhere = card({
      buttons: [
        { label: 'Go', style: 'default', action: { type: 'open_url', url: 'https://other.test/' } },
      ],
    });
    expect(codes(elsewhere, policy)).toEqual(['buttons[0].action.url:url_not_trusted']);
    const quick = card({
      buttons: [{ label: 'Papara', style: 'default', action: { type: 'send_message' } }],
    });
    expect(codes(quick, policy)).toEqual([]);
  });

  it('is not_a_card for nothing card-shaped, and says each problem in a sentence', () => {
    expect(richCardProblems(normalizeRichCard('nope'), { source: 'campaign' })).toEqual([
      { field: 'card', code: 'not_a_card' },
    ]);
    expect(describeRichCardProblem({ field: 'buttons[1].action.url', code: 'url' })).toBe(
      'buttons[1].action.url: must be an https: address.',
    );
  });
});

describe('normalizeRichCard', () => {
  it('trims, drops an empty title or image, defaults the style', () => {
    expect(
      normalizeRichCard({
        title: '  ',
        body: ' Hi ',
        image: { url: '', alt: ' ' },
        buttons: [{ label: ' Go ', action: { type: 'send_message', url: 'stale' } }],
      }),
    ).toEqual({
      body: 'Hi',
      buttons: [{ label: 'Go', style: 'default', action: { type: 'send_message' } }],
    });
  });

  it('a switched action starts empty — the old value is not carried over', () => {
    expect(emptyCardAction('open_url')).toEqual({ type: 'open_url', url: '' });
    expect(emptyCardAction('copy_coupon')).toEqual({ type: 'copy_coupon', code: '' });
    expect(emptyCardAction('send_message')).toEqual({ type: 'send_message' });
  });
});

describe('richCardFallbackText', () => {
  it('writes the title, the body and the buttons numbered with what they do', () => {
    expect(richCardFallbackText(card())).toBe(
      [
        'Deposit help',
        'Stuck on a deposit? We can help.',
        '1. Get help',
        '2. Rules: https://example.com/r',
        '3. Copy code: WELCOME50',
      ].join('\n'),
    );
  });
});

describe('readers', () => {
  it('readRichCard draws only a valid card; readCardPostback reads either source', () => {
    expect(readRichCard(card())).toEqual(card());
    expect(readRichCard({ body: '', buttons: [] })).toBeNull();
    expect(
      readCardPostback({
        postback: {
          source: 'campaign',
          campaign_id: 'c1',
          button: 0,
          label: 'Get help',
          card: card(),
        },
      }),
    ).toMatchObject({ source: 'campaign', label: 'Get help' });
    expect(
      readCardPostback({ postback: { source: 'event', event_id: 'e1', button: 1, label: 'Go' } }),
    ).toEqual({ source: 'event', event_id: 'e1', button: 1, label: 'Go' });
    expect(
      readCardPostback({ postback: { source: 'campaign', button: 0, label: 'x' } }),
    ).toBeNull();
    expect(readCardPostback(null)).toBeNull();
  });
});
