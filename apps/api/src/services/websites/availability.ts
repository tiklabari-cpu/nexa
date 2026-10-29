/**
 * The widget's availability mode as a per-brand setting (WG-09, tm 341):
 * whether a visitor may start a chat when no AI would answer and nobody is
 * accepting chats. Two readers: `GET /customer/chat`, which turns it into
 * `can_start_chat`, and `POST /customer/ticket`, which takes a message left
 * under `agents_only` even from a workspace that built no offline questions.
 *
 * No row, or a brand never saved, reads as the default (`always`).
 */
import {
  DEFAULT_WIDGET_AVAILABILITY_MODE,
  isWidgetAvailabilityMode,
  type WidgetAvailabilityMode,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { defaultBrandId } from './prechat.js';

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
