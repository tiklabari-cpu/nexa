/**
 * What a refused live connection says (tm 263), for the Apps key dialog and
 * the live Telegram form alike.
 *
 * The server refuses with an existing error type and a `details.reason`
 * (`app_credentials_invalid`, `app_provider_unavailable`,
 * `telegram_webhook_unreachable`) — the `signup_closed` precedent, so no new
 * `common.errors.*` key. The provider's own words travel as
 * `details.provider_message`, already stripped of anything resembling the key
 * on the server; this only quotes them. The key itself is never in an error,
 * so there is nothing here that could show it back.
 */
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import type { TFunction } from '../../lib/i18n.js';

export function liveConnectErrorText(t: TFunction, failure: unknown, name: string): string {
  if (failure instanceof ApiClientError) {
    const reason = failure.details?.['reason'];
    const providerReason = failure.details?.['provider_reason'];
    const message = failure.details?.['provider_message'];
    const said =
      typeof message === 'string' && message
        ? ` ${t('apps.live.error.providerSaid', { name, message })}`
        : '';
    if (reason === 'app_credentials_invalid') {
      return (
        (providerReason === 'not_found'
          ? t('apps.live.error.notFound', { name })
          : t('apps.live.error.invalidKey', { name })) + said
      );
    }
    if (reason === 'app_provider_unavailable') return t('apps.live.error.unavailable', { name });
    if (reason === 'telegram_webhook_unreachable') return t('apps.live.error.webhookUnreachable');
  }
  return t(errorMessageKey(failure));
}
