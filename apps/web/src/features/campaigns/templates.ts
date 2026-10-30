/**
 * The campaign template gallery (EN-05 · tm 354): Turkish iGaming starting
 * points the builder opens as an editable draft — nothing is saved, and nothing
 * runs, until the author presses Create. Same idea as
 * `features/playbook/templates.ts`.
 *
 * Three categories: greet a visitor, help one who is stuck, and promote. A
 * promotion carries `kind: 'promotion'` — a risk-flagged player is not sent one
 * (EN-01), and the gallery says so on the card. Every promotion ends with a
 * responsible-play line the author may keep or cut; it is plain text because
 * the template cannot know the operator's own responsible-gaming address, and a
 * guessed link would be worse than none.
 *
 * Words live in the catalogues (`campaigns.template.<id>.*`) so the gallery
 * reads in the panel's language; this file holds only the shape — which
 * template triggers on what — and `templateDraft` resolves the words.
 */
import type {
  CampaignConditions,
  CampaignContent,
  CampaignRule,
  CampaignMatchMode,
} from '@siyahtus/types';

export const CAMPAIGN_TEMPLATE_CATEGORIES = ['greet', 'help', 'promotion'] as const;
export type CampaignTemplateCategory = (typeof CAMPAIGN_TEMPLATE_CATEGORIES)[number];

export interface CampaignTemplate {
  id: string;
  category: CampaignTemplateCategory;
  /** `promotion` ones are held back from risk-flagged players (EN-01). */
  kind: 'info' | 'promotion';
  match: CampaignMatchMode;
  rules: readonly CampaignRule[];
  /** A card with one "send a message" button, or plain text. */
  content: 'text' | 'card';
}

const url = (value: string): CampaignRule => ({ field: 'current_url', op: 'contains', value });
const seconds = (value: number): CampaignRule => ({ field: 'time_on_page', op: 'gte', value });

export const CAMPAIGN_TEMPLATES: readonly CampaignTemplate[] = [
  {
    id: 'welcome_new',
    category: 'greet',
    kind: 'info',
    match: 'all',
    rules: [{ field: 'visitor_type', op: 'equals', value: 'new' }, seconds(10)],
    content: 'text',
  },
  {
    id: 'welcome_back',
    category: 'greet',
    kind: 'info',
    match: 'all',
    rules: [{ field: 'visitor_type', op: 'equals', value: 'returning' }, seconds(10)],
    content: 'text',
  },
  {
    id: 'deposit_help',
    category: 'help',
    kind: 'info',
    match: 'all',
    rules: [url('/yatirim'), seconds(30)],
    content: 'text',
  },
  {
    id: 'withdraw_help',
    category: 'help',
    kind: 'info',
    match: 'all',
    rules: [url('/cekim'), seconds(30)],
    content: 'text',
  },
  {
    id: 'login_help',
    category: 'help',
    kind: 'info',
    match: 'all',
    rules: [url('/giris'), seconds(20)],
    content: 'text',
  },
  {
    id: 'exit_intent',
    category: 'help',
    kind: 'info',
    match: 'all',
    rules: [{ field: 'exit_intent', op: 'equals', value: true }],
    content: 'card',
  },
  {
    id: 'welcome_bonus_terms',
    category: 'promotion',
    kind: 'promotion',
    match: 'all',
    rules: [url('/bonus'), seconds(15)],
    content: 'text',
  },
  {
    id: 'cashback_terms',
    category: 'promotion',
    kind: 'promotion',
    match: 'all',
    rules: [url('/promosyon'), seconds(15)],
    content: 'text',
  },
];

/** What the builder opens with: a name, the trigger and the message — all editable. */
export interface CampaignDraft {
  name: string;
  conditions: CampaignConditions;
  content: CampaignContent;
}

/** The template with its words filled in from the catalogue (`t`). */
export function templateDraft(
  template: CampaignTemplate,
  t: (key: string) => string,
): CampaignDraft {
  const key = (part: string): string => `campaigns.template.${template.id}.${part}`;
  const content: CampaignContent =
    template.content === 'card'
      ? {
          type: 'card',
          card: {
            title: t(key('cardTitle')),
            body: t(key('cardBody')),
            buttons: [
              { label: t(key('cardButton')), style: 'primary', action: { type: 'send_message' } },
            ],
          },
        }
      : { message: t(key('message')) };
  return {
    name: t(key('name')),
    conditions: { match: template.match, rules: template.rules.map((rule) => ({ ...rule })) },
    content,
  };
}

/** The templates of one category, in gallery order. */
export function templatesIn(category: CampaignTemplateCategory): CampaignTemplate[] {
  return CAMPAIGN_TEMPLATES.filter((template) => template.category === category);
}
