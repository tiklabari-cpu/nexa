/**
 * Outbound webhook registry — FR-MOD-08.8.4 (register / list / unregister).
 *
 * On the storage of the signing secret. The subtask brief reads "secret shown
 * once, hash stored" — the pattern used for PATs and invitation tokens, where
 * the server only ever *verifies* an incoming credential and so keeps a
 * one-way hash. A webhook secret is the opposite direction: the server *signs*
 * every outbound delivery with it (HMAC is symmetric — see `signature.ts`), so
 * a hash would make signing impossible. The schema names the column `secret_key`
 * precisely because it is a retained signing key, not a verifier. "Shown once"
 * is therefore honoured the only way it can be: the key is returned from the
 * register call and never again — `list` selects every column *except* the
 * secret, so read access to the webhook list can never recover it.
 *
 * Isolation is enforced by RLS: every query below runs inside `withTenant`, so a
 * webhook belongs to exactly one license and another tenant's rows are invisible
 * to list, get and delete alike (NFR-S5).
 */
import { generateToken } from '../../lib/crypto.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/**
 * The events a webhook can subscribe to. A closed vocabulary so an unknown
 * action is refused at registration rather than stored as a subscription that
 * can never fire.
 */
export const WEBHOOK_ACTIONS = [
  'chat_started',
  'chat_deactivated',
  'chat_transferred',
  'event_created',
  'ticket_created',
] as const;
export type WebhookAction = (typeof WEBHOOK_ACTIONS)[number];

/** `license` for a workspace-wide hook, `bot` for one scoped to a bot client. */
export const WEBHOOK_TYPES = ['license', 'bot'] as const;
export type WebhookType = (typeof WEBHOOK_TYPES)[number];

export interface Webhook {
  id: string;
  url: string;
  action: WebhookAction;
  type: WebhookType;
  enabled: boolean;
  created_at: string;
}

/** The register response — a webhook plus its signing secret, returned once. */
export interface WebhookRegistration extends Webhook {
  secret: string;
}

/** The non-secret columns. `secret_key` is intentionally never selected. */
interface WebhookRow {
  id: string;
  url: string;
  action: string;
  type: string;
  enabled: boolean;
  createdAt: Date;
}

const SAFE_SELECT = {
  id: true,
  url: true,
  action: true,
  type: true,
  enabled: true,
  createdAt: true,
} as const;

export class WebhookService {
  async list(tx: TenantClient): Promise<Webhook[]> {
    // RLS narrows to the caller's license; oldest-first gives a stable order.
    const rows = await tx.webhook.findMany({ orderBy: { createdAt: 'asc' }, select: SAFE_SELECT });
    return rows.map((row) => this.serialise(row));
  }

  /**
   * Register a webhook and return its signing secret exactly once. The secret is
   * generated here, stored to sign future deliveries, and returned on this
   * response only — it is never selected back by `list`.
   */
  async register(
    tx: TenantClient,
    tenant: TenantContext,
    input: { url: string; action: WebhookAction; type?: WebhookType; clientId?: string | null },
  ): Promise<WebhookRegistration> {
    // 192 bits, prefixed so a leaked value is recognisable as a webhook secret.
    const secret = `whsec_${generateToken(24)}`;
    const row = await tx.webhook.create({
      data: {
        licenseId: tenant.licenseId,
        url: input.url,
        action: input.action,
        type: input.type ?? 'license',
        clientId: input.clientId ?? null,
        secretKey: secret,
      },
      select: SAFE_SELECT,
    });
    return { ...this.serialise(row), secret };
  }

  /**
   * Scoped delete rather than delete-by-id: `deleteMany` under RLS removes
   * nothing when the id belongs to another tenant, so the route answers 404
   * instead of silently destroying a stranger's webhook. Cascades take the
   * delivery log with it.
   */
  async unregister(tx: TenantClient, id: string): Promise<number> {
    const { count } = await tx.webhook.deleteMany({ where: { id } });
    return count;
  }

  serialise(row: WebhookRow): Webhook {
    return {
      id: row.id,
      url: row.url,
      action: row.action as WebhookAction,
      type: row.type as WebhookType,
      enabled: row.enabled,
      created_at: row.createdAt.toISOString(),
    };
  }
}
