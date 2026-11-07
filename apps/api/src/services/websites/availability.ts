/**
 * The widget's availability mode as a per-brand setting (WG-09, tm 341):
 * whether a visitor may start a chat when no AI would answer and nobody is
 * accepting chats. Two readers: `GET /customer/chat`, which turns it into
 * `can_start_chat`, and `POST /customer/ticket`, which takes a message left
 * under `agents_only` even from a workspace that built no offline questions.
 *
 * No row, or a brand never saved, reads as the default (`always`). The draft
 * preview switch (tm 417) is read here too, by the same brand rule, together
 * with HIPAA scope.
 */
import {
  DEFAULT_WIDGET_APPEARANCE,
  DEFAULT_WIDGET_AVAILABILITY_MODE,
  isWidgetAvailabilityMode,
  type WidgetAvailabilityMode,
} from '@siyahtus/types';
import { inHipaaScope } from '../../lib/hipaa.js';
import type { TenantClient } from '../../lib/tenant.js';
import { defaultBrandId } from './prechat.js';

/**
 * The two stored inputs of `typingPreviewAllowed` (tm 417 · K3/K8): the
 * workspace switch `widget_settings.sneak_peek_enabled` for the token's brand,
 * else the default brand (the mode's rule, below), and HIPAA scope.
 *
 * One statement, because `POST /customer/chat/typing` promises at most four a
 * request and the licence gate already spends one: the switch is read as a
 * count of this brand's rows that differ from the default, which rides on the
 * licence read where selecting the row would be a second statement. No row —
 * a brand never saved — reads as the default.
 */
export async function readTypingPreviewInputs(
  tx: TenantClient,
  licenseId: bigint,
  brandId: string | undefined,
): Promise<{ enabled: boolean; hipaa: boolean }> {
  const fallback = DEFAULT_WIDGET_APPEARANCE.sneak_peek_enabled;
  const licence = await tx.license.findUnique({
    where: { id: licenseId },
    select: {
      hipaaBaaSignedAt: true,
      _count: {
        select: {
          widgetSettings: {
            where: {
              ...(brandId ? { brandId } : { brand: { isDefault: true } }),
              sneakPeekEnabled: !fallback,
            },
          },
        },
      },
    },
  });
  return {
    enabled: (licence?._count.widgetSettings ?? 0) > 0 ? !fallback : fallback,
    hipaa: inHipaaScope(licence),
  };
}

/** The mode a customer token's widget runs under: its brand's, else the licence default's. */
export async function readCustomerAvailabilityMode(
  tx: TenantClient,
  brandId: string | undefined,
): Promise<WidgetAvailabilityMode> {
  const resolved = brandId ?? (await defaultBrandId(tx));
  if (!resolved) return DEFAULT_WIDGET_AVAILABILITY_MODE;
  const row = await tx.widgetSettings.findFirst({
    where: { brandId: resolved },
    select: { availabilityMode: true },
  });
  return isWidgetAvailabilityMode(row?.availabilityMode)
    ? row.availabilityMode
    : DEFAULT_WIDGET_AVAILABILITY_MODE;
}
