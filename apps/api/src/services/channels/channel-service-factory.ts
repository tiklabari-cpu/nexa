/**
 * The one way a process builds its `ChannelService` (tm 380): the inbound
 * channel routes, the agent's chat routes and the scheduler must agree on
 * which channels run live, or an agent's reply would leave through a mock the
 * webhook no longer feeds. Live Telegram (tm 263) and live WhatsApp (tm 380)
 * are switched on by the same environment, through the same safe client — and
 * so are live Messenger and Instagram (tm 381).
 */
import type { Env } from '../../config/env.js';
import { createSafeHttp, type SafeHttp } from '../../lib/safe-fetch.js';
import {
  DEFAULT_PROVIDER_ENDPOINTS,
  type ProviderContext,
  type ProviderEndpoints,
} from '../apps/verifiers/types.js';
import type { Mailer } from '../mail/mailer.js';
import { ChannelService } from './channel-service.js';
import { createLiveTelegram } from './telegram-live.js';
import { createLiveMetaMessaging } from './meta-messaging-live.js';
import { createLiveWhatsApp } from './whatsapp-live.js';

export interface ChannelServiceDeps {
  /** The provider client. Omitted, the real safe client; tests pin it to a local fake. */
  http?: SafeHttp;
  /** Provider hosts. Omitted, the real ones. */
  endpoints?: ProviderEndpoints;
  /** Where the "reconnect needed" notice goes. Omitted, the channel is marked, not mailed. */
  mailer?: Mailer;
  log?: { warn: (obj: object, msg: string) => void };
}

export function buildChannelService(env: Env, deps: ChannelServiceDeps = {}): ChannelService {
  const context: ProviderContext = {
    http: deps.http ?? createSafeHttp(),
    endpoints: deps.endpoints ?? DEFAULT_PROVIDER_ENDPOINTS,
  };
  return new ChannelService(createLiveTelegram(env, context), {
    whatsapp: createLiveWhatsApp(env, context),
    // Live Messenger / Instagram (tm 381): the same Meta app, the same client.
    meta: createLiveMetaMessaging(env, context),
    reconnect: {
      auditChainSecret: env.AUDIT_CHAIN_SECRET,
      appUrl: env.WEB_APP_URL,
      ...(deps.mailer ? { mailer: deps.mailer } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    },
  });
}
