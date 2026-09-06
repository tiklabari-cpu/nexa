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
import type { AppAutomationStats } from '@nexa/types';
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
  /**
   * The automation card this subscription is attached to (FR-MOD-09.4), or null
   * for a hand-registered webhook. What makes a Zapier/Make connection more
   * than a label: a subscription with an `app_id` is created only while that
   * card is connected and is removed when it is disconnected, so "no connection
   * → nothing fires" is a property of the registry rather than a promise.
   */
  app_id: string | null;
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
  appId: string | null;
}

const SAFE_SELECT = {
  id: true,
  url: true,
  action: true,
  type: true,
  enabled: true,
  createdAt: true,
  appId: true,
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
    input: {
      url: string;
      action: WebhookAction;
      type?: WebhookType;
      clientId?: string | null;
      /** An automation card id (FR-MOD-09.4). The caller has already checked it is connected. */
      appId?: string | null;
    },
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
        appId: input.appId ?? null,
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

  /**
   * Remove every subscription attached to an automation card (FR-MOD-09.4).
   *
   * Called when the card is disconnected, in the same transaction, because that
   * is what makes the negative gate real: after a disconnect there is no row
   * left for the dispatcher to find, so the same workspace event that used to
   * reach the zap now reaches nothing. Leaving the rows behind (disabled, say)
   * would mean a reconnect silently resurrecting targets the admin last saw
   * months ago.
   */
  async unregisterForApp(tx: TenantClient, appId: string): Promise<number> {
    const { count } = await tx.webhook.deleteMany({ where: { appId } });
    return count;
  }

  /**
   * What each named automation card has actually got wired, for this workspace
   * (FR-MOD-09.4): how many enabled subscriptions it owns, and when one of them
   * last delivered successfully.
   *
   * Two queries regardless of how many cards are asked about, and both scoped
   * by RLS through `tx`. `last_run_at` counts only `ok` attempts — "last run"
   * on a card has to mean the automation ran, not that we tried and the
   * receiver was down; a failed burst is visible in the delivery log, which is
   * where an operator debugging one should be looking.
   */
  async automationStats(
    tx: TenantClient,
    appIds: readonly string[],
  ): Promise<Map<string, AppAutomationStats>> {
    const stats = new Map<string, AppAutomationStats>(
      appIds.map((appId) => [appId, { triggers: 0, last_run_at: null }]),
    );
    if (appIds.length === 0) return stats;

    const hooks = await tx.webhook.findMany({
      where: { appId: { in: [...appIds] } },
      select: { id: true, appId: true, enabled: true },
    });
    if (hooks.length === 0) return stats;

    for (const hook of hooks) {
      if (!hook.enabled || !hook.appId) continue;
      const entry = stats.get(hook.appId);
      if (entry) entry.triggers += 1;
    }

    // Every attempt row of every subscription this card owns — disabled ones
    // included, because a run that happened is history and switching the
    // subscription off afterwards does not un-happen it.
    const runs = await tx.webhookDelivery.groupBy({
      by: ['webhookId'],
      where: { webhookId: { in: hooks.map((hook) => hook.id) }, ok: true },
      _max: { createdAt: true },
    });
    const appOfHook = new Map(hooks.map((hook) => [hook.id, hook.appId]));
    for (const run of runs) {
      const appId = appOfHook.get(run.webhookId);
      const at = run._max.createdAt;
      if (!appId || !at) continue;
      const entry = stats.get(appId);
      if (!entry) continue;
      if (!entry.last_run_at || entry.last_run_at < at.toISOString()) {
        entry.last_run_at = at.toISOString();
      }
    }
    return stats;
  }

  serialise(row: WebhookRow): Webhook {
    return {
      id: row.id,
      url: row.url,
      action: row.action as WebhookAction,
      type: row.type as WebhookType,
      enabled: row.enabled,
      created_at: row.createdAt.toISOString(),
      app_id: row.appId,
    };
  }
}
