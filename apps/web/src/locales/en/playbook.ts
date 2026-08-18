import type { Messages } from '../merge.js';

/**
 * Playbook — the skill template catalogue (NFR-I18N2).
 *
 * Keys are `playbook.template.<id>.name` / `.summary`, `<id>` matching
 * `SkillTemplate.id` in `features/playbook/templates.ts`. `instruction`/`steps`
 * are deliberately absent — see that file's module note.
 */
export const playbook: Messages = {
  'playbook.template.order-status.name': 'Where is my order?',
  'playbook.template.order-status.summary':
    'Collect the order number, tag it, and answer from your knowledge base.',
  'playbook.template.returns-policy.name': 'Returns policy',
  'playbook.template.returns-policy.summary':
    'Recognise a returns question and answer it from your indexed policy.',
  'playbook.template.business-hours.name': 'Opening hours',
  'playbook.template.business-hours.summary':
    'A fixed reply for “are you open?”, no knowledge base required.',
  'playbook.template.shipping-cost.name': 'Shipping costs',
  'playbook.template.shipping-cost.summary':
    'Answer shipping cost questions straight from your knowledge base.',
  'playbook.template.order-cancellation.name': 'Cancel an order',
  'playbook.template.order-cancellation.summary':
    'Collect the order number and route a cancellation request to support.',
  'playbook.template.payment-methods.name': 'Accepted payment methods',
  'playbook.template.payment-methods.summary':
    'Recognise a payment-methods question and answer it from your knowledge base.',
  'playbook.template.change-shipping-address.name': 'Change a shipping address',
  'playbook.template.change-shipping-address.summary':
    'Collect the order number and route an address change to support.',
  'playbook.template.warranty-coverage.name': 'Warranty coverage',
  'playbook.template.warranty-coverage.summary':
    'A fixed explanation of what your warranty covers, answered from your knowledge base.',
  'playbook.template.contact-support.name': 'How to reach us',
  'playbook.template.contact-support.summary':
    'A fixed reply with your contact channels, no knowledge base required.',
  'playbook.template.discount-code-issue.name': 'Discount code not working',
  'playbook.template.discount-code-issue.summary':
    'Collect the code and route it to support to sort out.',
  'playbook.template.delete-my-account.name': 'Delete my account',
  'playbook.template.delete-my-account.summary':
    'Recognise an account-deletion request and route it to the support team.',
  'playbook.template.greet-and-route.name': 'Greet and find the topic',
  'playbook.template.greet-and-route.summary':
    'Open warmly, then let the assistant answer from what it knows.',
  'playbook.template.collect-then-handover.name': 'Collect details, then hand over',
  'playbook.template.collect-then-handover.summary':
    'Ask for an email, summarise the chat, and pass it to a human team.',
  'playbook.template.troubleshoot-then-escalate.name': 'Troubleshoot, then escalate',
  'playbook.template.troubleshoot-then-escalate.summary':
    'Try a knowledge-based answer first, then summarise and hand over if that is not enough.',
  'playbook.template.angry-customer-deescalate.name': 'De-escalate an upset customer',
  'playbook.template.angry-customer-deescalate.summary':
    'Acknowledge the frustration, summarise the issue, and hand it to a senior agent.',
  'playbook.template.product-recommendation.name': 'Recommend a product',
  'playbook.template.product-recommendation.summary':
    'Ask what the customer needs, then answer with a recommendation from your knowledge base.',
  'playbook.template.onboarding-walkthrough.name': 'Guide a new user',
  'playbook.template.onboarding-walkthrough.summary':
    'Welcome a new user warmly, then answer their first questions from the knowledge base.',
  'playbook.template.billing-question-lookup.name': 'Answer a billing question',
  'playbook.template.billing-question-lookup.summary':
    'Tag billing questions and answer them from your knowledge base.',
  'playbook.template.cancel-subscription-handover.name': 'Cancel a subscription',
  'playbook.template.cancel-subscription-handover.summary':
    'Understand why, summarise it, and route the cancellation to the billing team.',
  'playbook.template.vip-customer-priority.name': 'Prioritise a VIP customer',
  'playbook.template.vip-customer-priority.summary':
    'Recognise a top-tier customer and route them straight to a senior agent.',
  'playbook.template.multilingual-greeting.name': 'Greet in the customer’s language',
  'playbook.template.multilingual-greeting.summary':
    'Recognise a Spanish greeting and reply in kind before answering.',
  'playbook.template.post-purchase-checkin.name': 'Check in after a purchase',
  'playbook.template.post-purchase-checkin.summary':
    'Ask how the product is working out, then answer from your knowledge base.',
  'playbook.template.shopify-order-lookup.name': 'Look up an order in Shopify',
  'playbook.template.shopify-order-lookup.summary':
    'Ask for the order number and check its status in your store.',
  'playbook.template.stripe-refund.name': 'Start a refund in Stripe',
  'playbook.template.stripe-refund.summary':
    'Take the order number and route the refund to the billing team.',
  'playbook.template.csat-followup.name': 'Ask for feedback',
  'playbook.template.csat-followup.summary':
    'Once things are resolved, summarise and ask how it went.',
  'playbook.template.paypal-refund.name': 'Start a refund in PayPal',
  'playbook.template.paypal-refund.summary':
    'Take the order number and send the PayPal refund to the billing team.',
  'playbook.template.salesforce-case-sync.name': 'Log a case in Salesforce',
  'playbook.template.salesforce-case-sync.summary':
    'Capture the details and file the issue as a case for the support team.',
  'playbook.template.klaviyo-abandoned-cart.name': 'Recover an abandoned cart',
  'playbook.template.klaviyo-abandoned-cart.summary':
    'Reply to a cart question and offer a hand finishing the purchase.',
  'playbook.template.recharge-subscription-pause.name': 'Pause a subscription in Recharge',
  'playbook.template.recharge-subscription-pause.summary':
    'Collect the subscription id and route the pause request to billing.',
  'playbook.template.calendly-book-a-call.name': 'Book a call in Calendly',
  'playbook.template.calendly-book-a-call.summary':
    'Reply with a scheduling link when someone wants to talk to a person.',
  'playbook.template.shipstation-tracking-update.name': 'Check a live tracking update',
  'playbook.template.shipstation-tracking-update.summary':
    'Ask for the order number and reply that you are checking its tracking status.',
  'playbook.template.quickbooks-invoice-lookup.name': 'Look up an invoice in QuickBooks',
  'playbook.template.quickbooks-invoice-lookup.summary':
    'Ask for the invoice number and route billing questions to the billing team.',
  'playbook.template.edit-order-before-shipping.name': 'Edit an order before it ships',
  'playbook.template.edit-order-before-shipping.summary':
    'Collect the order number and change request, then route it to support fast.',
};
