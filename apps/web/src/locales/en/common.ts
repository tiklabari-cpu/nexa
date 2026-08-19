import type { Messages } from '../merge.js';

/**
 * Shared text — chiefly the ADR-06 error taxonomy rendered for a human.
 *
 * `common.errors.<type>` covers every member of `ERROR_TYPES` (@nexa/types),
 * plus the client-only `network` and a final `unknown` for a thrown value that
 * is not an `ApiClientError` at all. `api-client.ts`'s `errorMessageKey()` is
 * the only thing that builds these keys, and `i18n-coverage.test.ts` fails if
 * the taxonomy grows a type this file has not answered for.
 *
 * The server's own `message` is English prose meant for the developer reading a
 * log line, and it is never shown: a console in Turkish that answers a failed
 * save with "Chat is not active." is not translated, it is half-translated.
 * Anything a user genuinely needs beyond the sentence here — which field was
 * rejected — travels in `error.details`, not in the message.
 */
export const common: Messages = {
  'common.errors.account_exists': 'That email address already has an account.',
  'common.errors.authentication': 'Your session has expired — sign in again.',
  'common.errors.authorization': 'You do not have permission to do that.',
  'common.errors.brand_exists': 'A brand with that name already exists.',
  'common.errors.brand_not_found': 'We could not find that brand.',
  'common.errors.chat_anonymized': 'This conversation was anonymised and can no longer be opened.',
  'common.errors.chat_inactive': 'This conversation is no longer active.',
  'common.errors.customer_banned': 'This visitor is banned.',
  'common.errors.greeting_not_found': 'We could not find that greeting.',
  'common.errors.group_not_found': 'We could not find that team.',
  'common.errors.group_offline': 'That team is offline right now.',
  'common.errors.group_unavailable': 'That team cannot take this conversation right now.',
  'common.errors.groups_offline': 'Every team is offline right now.',
  'common.errors.internal': 'Something went wrong on our side — try again.',
  'common.errors.license_expired': 'Your subscription has ended — renew it to continue.',
  'common.errors.limit_reached': 'You have reached the limit for your plan.',
  'common.errors.message_rejected': 'That message was rejected.',
  'common.errors.misdirected_request': 'That request went to the wrong place — reload and retry.',
  'common.errors.network': 'Could not reach the server — check your connection.',
  'common.errors.not_allowed': 'That is not allowed here.',
  'common.errors.not_found': 'We could not find that.',
  'common.errors.pending_requests_limit_reached':
    'Too many requests are already waiting — try again shortly.',
  'common.errors.request_timeout': 'That took too long — try again.',
  'common.errors.sandbox_exists': 'This workspace already has a sandbox.',
  'common.errors.service_unavailable':
    'The service is temporarily unavailable — try again shortly.',
  'common.errors.takeover_conflict': 'Someone else took this conversation first.',
  'common.errors.ticket_exists': 'A ticket already exists for this conversation.',
  'common.errors.too_many_requests': 'Too many attempts — wait a moment and try again.',
  'common.errors.unknown': 'Something went wrong — try again.',
  'common.errors.unsupported_version': 'This page is out of date — reload and try again.',
  'common.errors.users_limit_reached': 'Your plan has no seats left.',
  'common.errors.validation': 'Check the highlighted fields and try again.',
  'common.errors.website_exists': 'That website is already connected.',
  'common.errors.wrong_product_version': 'This page is out of date — reload and try again.',
  // The design-system primitives' own defaults — a caller that passes no label
  // still gets one in the agent's language (Banner.tsx, Panel.tsx).
  'common.actions.dismiss': 'Dismiss',
  'common.actions.collapsePanel': 'Collapse panel',
};
