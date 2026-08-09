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
 * The catalogue (31+ per PRD §5.3 / FR-MOD-05.1). Every entry mirrors a real
 * support workflow and stays legible on its own — a template an admin cannot
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
    id: 'shipping-cost',
    name: 'Shipping costs',
    category: 'prebuilt',
    summary: 'Answer shipping cost questions straight from your knowledge base.',
    badge: 'popular',
    instruction:
      'When someone asks how much shipping costs, tag it as shipping.\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'shipping_cost',
        phrases: ['shipping cost', 'delivery fee', 'how much is shipping', 'shipping price'],
      },
      { type: 'tag', tag: 'shipping' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'order-cancellation',
    name: 'Cancel an order',
    category: 'prebuilt',
    summary: 'Collect the order number and route a cancellation request to support.',
    instruction:
      'When someone wants to cancel an order, ask for their order number.\nTag it as cancellation.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'order_cancellation',
        phrases: ['cancel my order', 'cancel order', 'do not want it anymore'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'tag', tag: 'cancellation' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'payment-methods',
    name: 'Accepted payment methods',
    category: 'prebuilt',
    summary: 'Recognise a payment-methods question and answer it from your knowledge base.',
    instruction:
      'When someone asks what payment methods you accept, answer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'payment_methods',
        phrases: ['payment methods', 'how can i pay', 'accept paypal', 'credit card'],
      },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'change-shipping-address',
    name: 'Change a shipping address',
    category: 'prebuilt',
    summary: 'Collect the order number and route an address change to support.',
    instruction:
      'When someone wants to change their shipping address, ask for their order number.\nTag it as address-change.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'address_change',
        phrases: ['change my address', 'wrong address', 'update shipping address'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'tag', tag: 'address-change' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'warranty-coverage',
    name: 'Warranty coverage',
    category: 'prebuilt',
    summary: 'A fixed explanation of what your warranty covers, answered from your knowledge base.',
    instruction: 'When someone asks about warranty coverage, answer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'warranty',
        phrases: ['warranty', 'guarantee', 'is this covered', 'broken item'],
      },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'contact-support',
    name: 'How to reach us',
    category: 'prebuilt',
    summary: 'A fixed reply with your contact channels, no knowledge base required.',
    instruction:
      'When someone asks how to contact support, reply "You can reach us right here in chat, or email support@acme.com — we usually respond within a few hours."',
    steps: [
      {
        type: 'detect_intent',
        intent: 'contact_support',
        phrases: ['contact you', 'phone number', 'email address', 'talk to a human'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'You can reach us right here in chat, or email support@acme.com — we usually respond within a few hours.',
      },
    ],
  },
  {
    id: 'discount-code-issue',
    name: 'Discount code not working',
    category: 'prebuilt',
    summary: 'Collect the code and route it to support to sort out.',
    instruction:
      'When someone says a discount code is not working, ask for the code.\nTag it as discount.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'discount_code',
        phrases: ['discount code', 'promo code', 'coupon not working'],
      },
      {
        type: 'request_info',
        field: 'discount_code',
        prompt: 'What discount code are you trying to use?',
      },
      { type: 'tag', tag: 'discount' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'delete-my-account',
    name: 'Delete my account',
    category: 'prebuilt',
    summary: 'Recognise an account-deletion request and route it to the support team.',
    instruction:
      'When someone asks to delete their account, tag it as privacy.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'account_deletion',
        phrases: ['delete my account', 'close my account', 'remove my data'],
      },
      { type: 'tag', tag: 'privacy' },
      { type: 'transfer_to_team', group: 'Support' },
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
    id: 'troubleshoot-then-escalate',
    name: 'Troubleshoot, then escalate',
    category: 'ai',
    summary: 'Try a knowledge-based answer first, then summarise and hand over if that is not enough.',
    badge: 'essential',
    instruction:
      'When someone reports a problem with the product, answer from the knowledge base.\nWrite a summary for the agent who picks it up.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'product_issue',
        phrases: ['not working', 'broken', 'error', 'stopped working'],
      },
      { type: 'send_message', source: 'knowledge' },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'angry-customer-deescalate',
    name: 'De-escalate an upset customer',
    category: 'ai',
    summary: 'Acknowledge the frustration, summarise the issue, and hand it to a senior agent.',
    instruction:
      'When someone sounds frustrated or angry, reply "I’m sorry this has been frustrating — let me get this to someone who can help right away."\nWrite a summary for the agent who picks it up.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'complaint',
        phrases: ['angry', 'frustrated', 'unacceptable', 'terrible service'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'I’m sorry this has been frustrating — let me get this to someone who can help right away.',
      },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'product-recommendation',
    name: 'Recommend a product',
    category: 'ai',
    summary: 'Ask what the customer needs, then answer with a recommendation from your knowledge base.',
    instruction:
      'When someone asks for a product recommendation, ask what they are trying to do.\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'recommendation',
        phrases: ['what should i buy', 'recommend', 'which one is best'],
      },
      { type: 'request_info', field: 'use_case', prompt: 'What are you hoping to use it for?' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'onboarding-walkthrough',
    name: 'Guide a new user',
    category: 'ai',
    summary: 'Welcome a new user warmly, then answer their first questions from the knowledge base.',
    instruction:
      'When someone says they are new or just signed up, reply "Welcome aboard! Happy to help you get started."\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'onboarding',
        phrases: ['just signed up', 'new here', 'getting started', 'how do i begin'],
      },
      { type: 'send_message', source: 'text', text: 'Welcome aboard! Happy to help you get started.' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'billing-question-lookup',
    name: 'Answer a billing question',
    category: 'ai',
    summary: 'Tag billing questions and answer them from your knowledge base.',
    instruction:
      'When someone asks about a charge or invoice, tag it as billing.\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'billing',
        phrases: ['charge', 'invoice', 'billing question', 'charged twice'],
      },
      { type: 'tag', tag: 'billing' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'cancel-subscription-handover',
    name: 'Cancel a subscription',
    category: 'ai',
    summary: 'Understand why, summarise it, and route the cancellation to the billing team.',
    instruction:
      'When someone wants to cancel their subscription, ask why they are leaving.\nWrite a summary for the agent who picks it up.\nHand over to the billing team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'cancel_subscription',
        phrases: ['cancel my subscription', 'cancel plan', 'stop billing me'],
      },
      {
        type: 'request_info',
        field: 'cancellation_reason',
        prompt: 'Mind sharing why you’d like to cancel?',
      },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Billing' },
    ],
  },
  {
    id: 'vip-customer-priority',
    name: 'Prioritise a VIP customer',
    category: 'ai',
    summary: 'Recognise a top-tier customer and route them straight to a senior agent.',
    badge: 'popular',
    instruction:
      'When someone mentions they are a long-time or premium customer, reply "Thanks for being with us — let me get you straight to a senior agent."\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'vip_customer',
        phrases: ['premium customer', 'been with you for years', 'loyal customer'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'Thanks for being with us — let me get you straight to a senior agent.',
      },
      { type: 'transfer_to_team', group: 'Support' },
    ],
  },
  {
    id: 'multilingual-greeting',
    name: 'Greet in the customer’s language',
    category: 'ai',
    summary: 'Recognise a Spanish greeting and reply in kind before answering.',
    instruction:
      'When someone says hello in Spanish, reply "¡Hola! ¿Cómo puedo ayudarte hoy?"\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'greeting_es',
        phrases: ['hola', 'buenos dias', 'buenas tardes'],
      },
      { type: 'send_message', source: 'text', text: '¡Hola! ¿Cómo puedo ayudarte hoy?' },
      { type: 'send_message', source: 'knowledge' },
    ],
  },
  {
    id: 'post-purchase-checkin',
    name: 'Check in after a purchase',
    category: 'ai',
    summary: 'Ask how the product is working out, then answer from your knowledge base.',
    instruction:
      'When someone mentions a recent purchase, ask how it is working out for them.\nAnswer from the knowledge base.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'post_purchase',
        phrases: ['just bought', 'recently purchased', 'got my order'],
      },
      { type: 'request_info', field: 'experience', prompt: 'How has it been working out for you so far?' },
      { type: 'send_message', source: 'knowledge' },
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
  {
    id: 'paypal-refund',
    name: 'Start a refund in PayPal',
    category: 'trending',
    summary: 'Take the order number and send the PayPal refund to the billing team.',
    instruction:
      'When someone asks for a refund paid through PayPal, ask for their order number.\nHand over to the billing team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'paypal_refund',
        phrases: ['paypal refund', 'refund my paypal payment'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'transfer_to_team', group: 'Billing' },
    ],
    requiresIntegration: 'PayPal',
  },
  {
    id: 'salesforce-case-sync',
    name: 'Log a case in Salesforce',
    category: 'trending',
    summary: 'Capture the details and file the issue as a case for the support team.',
    instruction:
      'When someone reports an issue that needs a case on file, ask for their order number.\nTag it as escalation.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'case_needed',
        phrases: ['open a case', 'file a complaint', 'need this logged'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'tag', tag: 'escalation' },
      { type: 'transfer_to_team', group: 'Support' },
    ],
    requiresIntegration: 'Salesforce',
  },
  {
    id: 'klaviyo-abandoned-cart',
    name: 'Recover an abandoned cart',
    category: 'trending',
    summary: 'Reply to a cart question and offer a hand finishing the purchase.',
    badge: 'popular',
    instruction:
      'When someone mentions items left in their cart, reply "I see you left something in your cart — want a hand finishing your order?"',
    steps: [
      {
        type: 'detect_intent',
        intent: 'abandoned_cart',
        phrases: ['left in my cart', 'saved cart', 'still in my basket'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'I see you left something in your cart — want a hand finishing your order?',
      },
    ],
    requiresIntegration: 'Klaviyo',
  },
  {
    id: 'recharge-subscription-pause',
    name: 'Pause a subscription in Recharge',
    category: 'trending',
    summary: 'Collect the subscription id and route the pause request to billing.',
    instruction:
      'When someone wants to pause their subscription, ask for their subscription id.\nHand over to the billing team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'pause_subscription',
        phrases: ['pause my subscription', 'skip this month', 'pause my plan'],
      },
      { type: 'request_info', field: 'subscription_id', prompt: 'What is your subscription ID?' },
      { type: 'transfer_to_team', group: 'Billing' },
    ],
    requiresIntegration: 'Recharge',
  },
  {
    id: 'calendly-book-a-call',
    name: 'Book a call in Calendly',
    category: 'trending',
    summary: 'Reply with a scheduling link when someone wants to talk to a person.',
    instruction:
      'When someone wants to schedule a call, reply "Sure — here is a link to grab a time that works for you: [booking link]."',
    steps: [
      {
        type: 'detect_intent',
        intent: 'schedule_call',
        phrases: ['book a call', 'schedule a demo', 'talk to someone'],
      },
      {
        type: 'send_message',
        source: 'text',
        text: 'Sure — here is a link to grab a time that works for you: [booking link].',
      },
    ],
    requiresIntegration: 'Calendly',
  },
  {
    id: 'shipstation-tracking-update',
    name: 'Check a live tracking update',
    category: 'trending',
    summary: 'Ask for the order number and reply that you are checking its tracking status.',
    instruction:
      'When someone asks for a tracking update, ask for their order number.\nReply that you are checking it now.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'tracking_update',
        phrases: ['tracking number', 'where is my package', 'track my shipment'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      {
        type: 'send_message',
        source: 'text',
        text: 'Thanks — let me check that tracking status for you.',
      },
    ],
    requiresIntegration: 'ShipStation',
  },
  {
    id: 'quickbooks-invoice-lookup',
    name: 'Look up an invoice in QuickBooks',
    category: 'trending',
    summary: 'Ask for the invoice number and route billing questions to the billing team.',
    instruction:
      'When someone asks about an invoice, ask for their invoice number.\nHand over to the billing team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'invoice_lookup',
        phrases: ['invoice number', 'missing invoice', 'need my invoice'],
      },
      { type: 'request_info', field: 'invoice_number', prompt: 'What is your invoice number?' },
      { type: 'transfer_to_team', group: 'Billing' },
    ],
    requiresIntegration: 'QuickBooks',
  },
  {
    id: 'edit-order-before-shipping',
    name: 'Edit an order before it ships',
    category: 'trending',
    summary: 'Collect the order number and change request, then route it to support fast.',
    instruction:
      'When someone wants to change an order before it ships, ask for their order number.\nTag it as order-edit.\nHand over to the support team.',
    steps: [
      {
        type: 'detect_intent',
        intent: 'edit_order',
        phrases: ['change my order', 'add an item to my order', 'edit my order before it ships'],
      },
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
      { type: 'tag', tag: 'order-edit' },
      { type: 'transfer_to_team', group: 'Support' },
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

/**
 * i18n keys for a template's user-facing card text (NFR-I18N2): `name` and
 * `summary` resolve through `apps/web/src/lib/i18n.ts`'s TR/EN catalogue
 * (`playbook.template.<id>.name` / `.summary`), one entry per catalogue
 * template. `instruction`/`steps` deliberately have no such key — they are the
 * literal text sent to the AI, and translating them would change behaviour,
 * not just chrome; see this module's top note.
 */
export function templateNameKey(id: string): string {
  return `playbook.template.${id}.name`;
}

/** See {@link templateNameKey}. */
export function templateSummaryKey(id: string): string {
  return `playbook.template.${id}.summary`;
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
