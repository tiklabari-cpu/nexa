/**
 * Skill template catalogue (FR-MOD-05.1 / 05.2).
 *
 * A deterministic, local library — no external service — so "Browse templates"
 * and the recommended cards show the same thing on every machine and in every
 * test. Each template carries a real instruction *and* the compiled steps it
 * maps to, so picking one opens an editor that already works: the admin edits a
 * skill rather than a blank page.
 *
 * The steps are authored to the same shapes the API validates on `POST /skills`
 * (`@nexa/ai-mock` `validateSteps`); `templates.test.ts` proves every one of
 * them passes, so "Use template" / "Try this" can never mint a skill the server
 * would reject.
 */
import type { SkillStep } from './types.js';

/** The template "types" an admin chooses between in the gallery. */
export type TemplateCategory = 'prebuilt' | 'ai' | 'trending';

export interface TemplateCategoryMeta {
  id: TemplateCategory;
  label: string;
  /** A one-glyph marker, matching the ✦/⚡ shorthand used on the skill list. */
  icon: string;
  description: string;
}

export const TEMPLATE_CATEGORIES: TemplateCategoryMeta[] = [
  { id: 'prebuilt', label: 'Prebuilt', icon: '◆', description: 'Ready-made answers for the questions every helpdesk gets.' },
  { id: 'ai', label: 'AI', icon: '✦', description: 'Detect the topic and reply in the assistant’s own words.' },
  { id: 'trending', label: 'Trending', icon: '↗', description: 'What teams are wiring up this month.' },
];

/**
 * A card highlight, orthogonal to `category` (FR-MOD-05.2 lists both axes:
 * Prebuilt/AI/Trending for kind, Popular/Essential for standing). A template
 * can carry at most one — or none.
 */
export type TemplateBadge = 'popular' | 'essential';

/** Upper bound on `summary`, so the catalogue stays readable as one card line past 8 entries. */
export const MAX_TEMPLATE_SUMMARY_LENGTH = 100;

export interface SkillTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** One line shown on the card. */
  summary: string;
  /** Pre-fills the editor's instruction field. */
  instruction: string;
  /** Pre-fills the compiled step list — already valid, see the module note. */
  steps: SkillStep[];
  /** Highlights the card independently of its `category`. Most templates carry none. */
  badge?: TemplateBadge;
  /**
   * Set when the skill can only do its job once an external system is
   * connected. The card warns, and the copy still opens so the admin can see
   * what it would do — it just will not resolve until the integration exists.
   */
  requiresIntegration?: string;
}

/**
 * The catalogue. Kept small and legible on purpose: a template an admin cannot
 * read at a glance is one they will not trust enough to ship.
 */
export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'order-status',
    name: 'Where is my order?',
    category: 'prebuilt',
    summary: 'Collect the order number, tag it, and answer from your knowledge base.',
    instruction:
      'When someone asks where their order is, ask for their order number.\nTag it as shipping.\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'order_status',
        phrases: ['where is my order', 'order status', 'delivery', 'tracking'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'tag', tag: 'shipping' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'returns-policy',
    name: 'Returns policy',
    category: 'prebuilt',
    summary: 'Recognise a returns question and answer it from your indexed policy.',
    instruction:
      'When someone asks about returns or refunds policy, tag it as returns.\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'returns',
        phrases: ['return', 'refund policy', 'send it back', 'exchange'],
      },
      { type: 'tag', tag: 'returns' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'business-hours',
    name: 'Opening hours',
    category: 'prebuilt',
    summary: 'A fixed reply for “are you open?”, no knowledge base required.',
    instruction:
      'When someone asks about opening hours, reply "We reply Monday to Friday, 9am to 6pm CET. Leave a message any time and we will get back to you."',
    steps: [
      {
        type: 'detect_intent',
        intent: 'business_hours',
        phrases: ['open', 'opening hours', 'what time', 'closed'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'We reply Monday to Friday, 9am to 6pm CET. Leave a message any time and we will get back to you.',
      },
    ],
  },
  {
    id: 'greet-and-route',
    name: 'Greet and find the topic',
    category: 'ai',
    summary: 'Open warmly, then let the assistant answer from what it knows.',
    instruction:
      'When someone says hello, reply "Hi! I’m the Acme assistant — how can I help today?"\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'greeting',
        phrases: ['hi', 'hello', 'hey', 'good morning'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'Hi! I’m the Acme assistant — how can I help today?',
      },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'collect-then-handover',
    name: 'Collect details, then hand over',
    category: 'ai',
    summary: 'Ask for an email, summarise the chat, and pass it to a human team.',
    instruction:
      'Ask for the customer’s email.\nWrite a summary for the agent who picks it up.\nHand over to the support team.',
    steps: [
      { type: 'request_info', field: 'email', prompt: 'What’s the best email to reach you on?' },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'shopify-order-lookup',
    name: 'Look up an order in Shopify',
    category: 'trending',
    summary: 'Ask for the order number and check its status in your store.',
    instruction:
      'When someone asks about an order, ask for their order number.\nReply that you are checking it now.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'order_status',
        phrases: ['where is my order', 'order status', 'track my order'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'send_message', source: 'text', text: 'Thanks — let me check that order for you.' },
    ],
    requiresIntegration: 'Shopify',
  },
  {
    id: 'stripe-refund',
    name: 'Start a refund in Stripe',
    category: 'trending',
    summary: 'Take the order number and route the refund to the billing team.',
    instruction:
      'When someone asks for a refund, ask for their order number.\nHand over to the billing team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'refund',
        phrases: ['refund', 'money back', 'cancel my order'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'transfer_to_team', group: 'Billing' },
    ],
    requiresIntegration: 'Stripe',
  },
  {
    id: 'csat-followup',
    name: 'Ask for feedback',
    category: 'trending',
    summary: 'Once things are resolved, summarise and ask how it went.',
    instruction:
      'Write a summary for the record.\nReply "Glad I could help! How would you rate this conversation?"',
    steps: [
      { type: 'summarize' },
      {
        type: 'send_message',
        source: 'text',
        text: 'Glad I could help! How would you rate this conversation?',
      },
    ],
  },
];

/** The fields `POST /skills` needs to mint a skill from a template. */
export interface SkillDraft {
  name: string;
  instruction: string;
  steps: SkillStep[];
}

/**
 * A fresh copy of a template's authorable content. Steps are cloned so an
 * editor mutating them cannot reach back into the shared catalogue.
 */
export function templateToDraft(template: SkillTemplate): SkillDraft {
  return {
    name: template.name,
    instruction: template.instruction,
    steps: template.steps.map((step) => ({ ...step })),
  };
}

/** Templates in one category, catalogue order preserved. */
export function templatesByCategory(category: TemplateCategory): SkillTemplate[] {
  return SKILL_TEMPLATES.filter((template) => template.category === category);
}

/** Look one up by id — used when a card only carries the id. */
export function findTemplate(id: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find((template) => template.id === id);
}

/** The display metadata (icon + label) for a category, for a card's type badge. */
export function findCategoryMeta(category: TemplateCategory): TemplateCategoryMeta | undefined {
  return TEMPLATE_CATEGORIES.find((meta) => meta.id === category);
}

/**
 * The templates featured in the Playbook's "Recommended skills" strip, in the
 * order shown (FR-MOD-05.2). A curated shortlist rather than the whole gallery:
 * all three categories are represented — interleaved so the first row spans them
 * — and one card needs an integration, so the strip carries the same up-front
 * warning the full gallery does. Anything not featured here is a "See more"
 * click away.
 */
export const RECOMMENDED_TEMPLATE_IDS: readonly string[] = [
  'order-status', // prebuilt
  'greet-and-route', // ai
  'shopify-order-lookup', // trending (needs Shopify)
  'returns-policy', // prebuilt
  'collect-then-handover', // ai
  'csat-followup', // trending
];

/**
 * The recommended templates resolved against the catalogue, order preserved. An
 * id that no longer resolves (a rename, a removal) is dropped rather than left
 * as a hole, so the strip can never render a blank card or throw.
 */
export function recommendedTemplates(): SkillTemplate[] {
  return RECOMMENDED_TEMPLATE_IDS.map(findTemplate).filter(
    (template): template is SkillTemplate => template !== undefined,
  );
}
