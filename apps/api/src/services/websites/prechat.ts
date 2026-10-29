/**
 * The widget's built-in pre-chat form as a per-brand setting (WG-01, tm 279).
 *
 * Three readers share this file: the settings screen (`/settings/prechat`),
 * the token mint, which hands the form to the widget, and the chat-open path
 * on `/customer/chat/events`, which enforces it. One reader per concern would
 * be three chances to disagree about what an unsaved brand means.
 *
 * Unsaved (`prechat_fields IS NULL`) reads as `DEFAULT_PRECHAT_CONFIG` — the
 * form the widget always showed — and is *not* enforced server-side, so a
 * workspace's existing direct Customer Chat API callers keep working until
 * somebody saves a requirement on purpose.
 */
import {
  DEFAULT_PRECHAT_CONFIG,
  normalizePrechatConfig,
  type PrechatConfig,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

export interface BrandPrechat {
  config: PrechatConfig;
  /** The brand has saved the form — the server enforces only then. */
  configured: boolean;
}

/** The brand's form, or today's defaults when it has never been saved. */
export async function readPrechat(tx: TenantClient, brandId: string): Promise<BrandPrechat> {
  const row = await tx.widgetSettings.findFirst({
    where: { brandId },
    select: { prechatEnabled: true, prechatFields: true },
  });
  return prechatFromRow(row);
}

export function prechatFromRow(
  row: { prechatEnabled: boolean; prechatFields: unknown } | null,
): BrandPrechat {
  if (!row || row.prechatFields === null || row.prechatFields === undefined) {
    return { config: normalizePrechatConfig(DEFAULT_PRECHAT_CONFIG), configured: false };
  }
  return {
    config: normalizePrechatConfig({ enabled: row.prechatEnabled, fields: row.prechatFields }),
    configured: true,
  };
}

/**
 * The form a customer token's conversation is held to: the brand signed into
 * the token, else the licence default. A licence without a default brand —
 * never in production, routinely in test fixtures — has nothing saved, so it
 * reads as unconfigured instead of failing the visitor's message.
 */
export async function readCustomerPrechat(
  tx: TenantClient,
  brandId: string | undefined,
): Promise<BrandPrechat> {
  const resolved = brandId ?? (await defaultBrandId(tx));
  return resolved ? readPrechat(tx, resolved) : prechatFromRow(null);
}

/**
 * Which brand a widget on `host` belongs to: the website registered for that
 * exact hostname, else the licence's default brand (undefined only for a
 * licence without one). The hosted Chat page has no website row of its own
 * and always takes the default. Shared by every
 * per-brand widget setting the mint serves (WG-01; WG-02/05/10 to follow).
 */
export async function resolveWidgetBrandId(
  tx: TenantClient,
  host: string,
  isChatPage: boolean,
): Promise<string | undefined> {
  if (!isChatPage) {
    const website = await tx.website.findFirst({
      where: { domain: host },
      select: { brandId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (website) return website.brandId;
  }
  return defaultBrandId(tx);
}

/** The licence's default brand, or undefined for a licence without one. */
export async function defaultBrandId(tx: TenantClient): Promise<string | undefined> {
  const brand = await tx.brand.findFirst({ where: { isDefault: true }, select: { id: true } });
  return brand?.id;
}

type IdentityField = 'name' | 'username' | 'email';
const IDENTITY_FIELDS: readonly IdentityField[] = ['name', 'username', 'email'];

/**
 * The required identity fields a conversation-opening message is missing:
 * neither sent with it nor already on the contact. Empty when the form is off
 * or was never saved. `message` is not checked here — every message already
 * carries text or an attachment, and a returning visitor opening a second
 * conversation with a screenshot must not be refused for it.
 */
export function missingPrechatFields(
  prechat: BrandPrechat,
  sent: Partial<Record<IdentityField, string | undefined>>,
  stored: Partial<Record<IdentityField, string | null>> | null,
): IdentityField[] {
  if (!prechat.configured || !prechat.config.enabled) return [];
  return IDENTITY_FIELDS.filter(
    (field) =>
      prechat.config.fields[field].required && !sent[field]?.trim() && !stored?.[field]?.trim(),
  );
}
