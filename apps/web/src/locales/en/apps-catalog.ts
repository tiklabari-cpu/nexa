import type { Messages } from '../merge.js';

/**
 * Marketplace card descriptions, one per catalogue id (`packages/types/src/apps.ts`). The API sends
 * English; the panel looks the text up here first so a Turkish agent reads Turkish (tm 413). An id
 * with no entry here shows the API’s own text (`apps-catalog.test.ts` keeps this list complete).
 */
export const appsCatalog: Messages = {
  'apps.catalog.hubspot': 'See a contact’s lifecycle stage and open deals while you chat.',
  'apps.catalog.shopify': 'Pull a customer’s orders and lifetime value into the conversation.',
  'apps.catalog.stripe': 'Show a customer’s subscription status and MRR next to the chat.',
  'apps.catalog.mailchimp': 'Know whether a contact is subscribed and how they engage.',
  'apps.catalog.google-calendar': 'Surface the next scheduled meeting with this customer.',
  'apps.catalog.salesforce': 'See the account type and open opportunities for a contact.',
  'apps.catalog.intercom': 'Bring a contact’s open conversations and lifecycle segment in.',
  'apps.catalog.zendesk': 'Show the customer’s open tickets and satisfaction next to the chat.',
  'apps.catalog.woocommerce':
    'Pull a WooCommerce customer’s orders and spend into the conversation.',
  'apps.catalog.magento': 'See an Adobe Commerce (Magento) shopper’s orders and customer group.',
  'apps.catalog.paypal': 'Show a customer’s PayPal account status and open disputes.',
  'apps.catalog.klaviyo': 'Know whether a contact is subscribed and how they buy.',
  'apps.catalog.slack': 'Surface a shared Slack Connect channel with this customer.',
  'apps.catalog.jira': 'Link the customer’s open Jira issues to the conversation.',
  'apps.catalog.zapier':
    'Trigger zaps from workspace events — register a Zapier app through the SiyahTuş partner portal.',
  'apps.catalog.make':
    'Run Make scenarios against this workspace — register a Make app through the SiyahTuş partner portal.',
  'apps.catalog.segment': 'See the customer’s recent product activity from your Segment stream.',
  'apps.catalog.pipedrive': 'See a contact’s deal stage and pipeline value while you chat.',
  'apps.catalog.zoho-crm': 'Show a lead’s status and assigned owner from Zoho CRM.',
  'apps.catalog.freshsales': 'Pull a contact’s deal count and funnel stage from Freshsales.',
  'apps.catalog.copper': 'See a contact’s pipeline and last activity from Copper CRM.',
  'apps.catalog.close-crm': 'Show a lead’s status and next scheduled task from Close.',
  'apps.catalog.insightly': 'Bring a contact’s project and opportunity count from Insightly.',
  'apps.catalog.freshdesk':
    'Show a customer’s open tickets and satisfaction rating from Freshdesk.',
  'apps.catalog.helpscout': 'See a customer’s conversation history and mailbox from Help Scout.',
  'apps.catalog.front': 'Surface a shared inbox conversation with this customer from Front.',
  'apps.catalog.gorgias': 'Show a shopper’s support ticket history from Gorgias.',
  'apps.catalog.kayako': 'Bring a customer’s case history and status from Kayako.',
  'apps.catalog.groove': 'See a customer’s ticket status and assignee from Groove.',
  'apps.catalog.bigcommerce': 'Pull a shopper’s orders and total spend from BigCommerce.',
  'apps.catalog.squarespace-commerce': 'Show a customer’s Squarespace order history.',
  'apps.catalog.wix-stores': 'See a shopper’s Wix Stores order count and loyalty tier.',
  'apps.catalog.prestashop': 'Bring a PrestaShop customer’s order and cart status in.',
  'apps.catalog.ecwid': 'Show an Ecwid shopper’s order history and total spend.',
  'apps.catalog.salesforce-commerce': 'See a shopper’s Salesforce Commerce Cloud order history.',
  'apps.catalog.square': 'Show a customer’s Square payment history and card on file.',
  'apps.catalog.braintree': 'See a customer’s Braintree subscription status.',
  'apps.catalog.adyen': 'Bring a customer’s Adyen payment status and risk score in.',
  'apps.catalog.razorpay': 'Show a customer’s Razorpay payment and subscription status.',
  'apps.catalog.authorize-net': 'See a customer’s Authorize.Net transaction history.',
  'apps.catalog.checkout-com': 'Bring a customer’s Checkout.com payment status into the chat.',
  'apps.catalog.activecampaign':
    'Know a contact’s automation status and engagement from ActiveCampaign.',
  'apps.catalog.constant-contact': 'See a contact’s email engagement from Constant Contact.',
  'apps.catalog.brevo': 'Bring a contact’s campaign engagement from Brevo.',
  'apps.catalog.convertkit': 'Show a subscriber’s tags and sequence status from ConvertKit.',
  'apps.catalog.drip': 'See a subscriber’s engagement and tags from Drip.',
  'apps.catalog.marketo': 'Bring a lead’s score and program status from Marketo.',
  'apps.catalog.notion': 'Link a customer’s shared Notion page to the conversation.',
  'apps.catalog.asana': 'See the customer’s open Asana tasks linked to this account.',
  'apps.catalog.trello': 'Surface the customer’s linked Trello card and list.',
  'apps.catalog.monday': 'Show the customer’s linked monday.com item status.',
  'apps.catalog.mixpanel': 'See the customer’s recent product events from Mixpanel.',
  'apps.catalog.amplitude': 'Bring a customer’s engagement score from Amplitude.',
  'apps.catalog.google-analytics':
    'Show a visitor’s session source and pageviews from Google Analytics.',
  'apps.catalog.hotjar': 'See if this visitor’s session was recorded by Hotjar.',
  'apps.catalog.heap': 'Bring the customer’s autocapture event history from Heap.',
  'apps.catalog.posthog':
    'See the customer’s feature flag exposure and recent events from PostHog.',
  'apps.catalog.keap': 'See a contact’s pipeline stage and tags from Keap.',
  'apps.catalog.nimble': 'Show a contact’s social profile and deal history from Nimble.',
  'apps.catalog.nutshell': 'Bring a lead’s stage and assigned rep from Nutshell.',
  'apps.catalog.vtiger': 'See a contact’s open cases and deal value from Vtiger.',
  'apps.catalog.sugarcrm': 'Show a contact’s account status and open opportunities from SugarCRM.',
  'apps.catalog.capsule-crm': 'Bring a contact’s pipeline stage and tags from Capsule CRM.',
  'apps.catalog.liveagent':
    'Show a customer’s open tickets and satisfaction rating from LiveAgent.',
  'apps.catalog.happyfox': 'See a customer’s ticket history and priority from HappyFox.',
  'apps.catalog.deskpro': 'Bring a customer’s ticket status and department from Deskpro.',
  'apps.catalog.teamsupport':
    'Show a customer’s open tickets and organization plan from TeamSupport.',
  'apps.catalog.helpcrunch':
    'See a customer’s conversation history and lead status from HelpCrunch.',
  'apps.catalog.vivantio': 'Bring a customer’s case status and SLA from Vivantio.',
  'apps.catalog.shopware':
    'Pull a Shopware customer’s orders and total spend into the conversation.',
  'apps.catalog.opencart': 'Show an OpenCart shopper’s order history and status.',
  'apps.catalog.volusion': 'See a Volusion customer’s order count and cart status.',
  'apps.catalog.shift4shop': 'Bring a Shift4Shop customer’s order history into the chat.',
  'apps.catalog.lightspeed-retail':
    'Show a customer’s in-store and online purchase history from Lightspeed.',
  'apps.catalog.commercetools':
    'Pull a shopper’s order history from commercetools into the conversation.',
  'apps.catalog.medusa':
    'Pull a Medusa storefront customer’s orders and region into the conversation.',
  'apps.catalog.mollie': 'Show a customer’s Mollie payment status and active subscription.',
  'apps.catalog.paddle': 'See a customer’s Paddle subscription plan and billing status.',
  'apps.catalog.worldpay': 'Bring a customer’s Worldpay transaction history into the chat.',
  'apps.catalog.gocardless': 'Show a customer’s GoCardless Direct Debit mandate and last payment.',
  'apps.catalog.klarna': 'See a customer’s Klarna order and installment status.',
  'apps.catalog.affirm': 'Bring a customer’s Affirm loan status into the conversation.',
  'apps.catalog.mailerlite':
    'Know whether a contact is subscribed and their open rate from MailerLite.',
  'apps.catalog.iterable': 'See a contact’s active journey and engagement from Iterable.',
  'apps.catalog.customer-io': 'Bring a contact’s email engagement from Customer.io into the chat.',
  'apps.catalog.sailthru': 'Show a contact’s lifecycle segment and engagement from Sailthru.',
  'apps.catalog.autopilot': 'See a contact’s active journey and tags from Autopilot.',
  'apps.catalog.sharpspring': 'Bring a lead’s score and active campaign from SharpSpring.',
  'apps.catalog.clickup': 'See the customer’s linked ClickUp task status.',
  'apps.catalog.basecamp': 'Surface the customer’s shared Basecamp project and to-do status.',
  'apps.catalog.airtable': 'Link the customer’s record in a shared Airtable base.',
  'apps.catalog.wrike': 'Show the customer’s linked Wrike task status.',
  'apps.catalog.matomo': 'See the visitor’s session count and goal conversions from Matomo.',
  'apps.catalog.fullstory': 'See if this visitor’s session was captured by FullStory.',
  'apps.catalog.pendo': 'Bring a customer’s feature adoption and NPS score from Pendo.',
  'apps.catalog.woopra': 'Show the customer’s last touchpoint and journey from Woopra.',
  'apps.catalog.crazyegg': 'See if this visitor’s session has a Crazy Egg heatmap recording.',
  'apps.catalog.kissmetrics': 'Bring the customer’s conversion funnel step from Kissmetrics.',
  'apps.catalog.whatsapp': 'Answer WhatsApp messages. Connected in Settings → Channels.',
  'apps.catalog.messenger': 'Answer Messenger conversations. Connected in Settings → Channels.',
  'apps.catalog.instagram': 'Answer Instagram direct messages. Connected in Settings → Channels.',
  'apps.catalog.telegram': 'Answer Telegram chats through a bot. Connected in Settings → Channels.',
  'apps.catalog.twilio-sms':
    'Reply to text messages over Twilio. Connected in Settings → Channels.',
};
