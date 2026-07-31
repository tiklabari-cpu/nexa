/**
 * IP-based customer bans (FR-MOD-08.9.2).
 *
 * The visitor ban — `Customer.bannedAt` — travels with an identity: a banned
 * visitor keeps their token and is refused when they act. This is the other
 * half: a ban on the *address*, so a visitor who clears cookies or opens a
 * fresh session is still refused. The two are enforced in different places for
 * that reason — the identity ban deep in `chat-service`, the address ban at the
 * request edge (`/customer/token` mint and the customer chat surface), where the
 * client IP is actually known.
 *
 * The list lives on `SecuritySettings.bannedCustomerIps`, a per-license
 * singleton, so the check is naturally tenant-scoped: one workspace's ban never
 * touches another's visitors.
 */
import type { TenantClient } from './tenant.js';

/**
 * Canonical form for comparing two IP strings.
 *
 * Trimmed and lowercased because IPv6 is case-insensitive (`::FFFF` and `::ffff`
 * are one address), and with the IPv4-mapped IPv6 prefix stripped so a proxy
 * that reports `::ffff:203.0.113.5` matches the `203.0.113.5` an admin typed.
 * Applied to both the stored entries and the incoming address, so the two are
 * compared in the same shape whatever form each arrived in.
 */
export function normaliseIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(trimmed);
  return mapped ? mapped[1]! : trimmed;
}

/**
 * Whether `ip` is on this license's banned-customer list.
 *
 * Reads the singleton `SecuritySettings` row through the caller's tenant-scoped
 * transaction — RLS narrows it to one license, and no row (a workspace that has
 * never saved these settings) means nothing is banned. A missing or empty
 * address is never banned: it is the absence of a signal, not a match.
 */
export async function isIpBanned(
  tx: TenantClient,
  ip: string | null | undefined,
): Promise<boolean> {
  if (!ip) return false;

  const row = await tx.securitySettings.findFirst({ select: { bannedCustomerIps: true } });
  if (!row || row.bannedCustomerIps.length === 0) return false;

  const target = normaliseIp(ip);
  return row.bannedCustomerIps.some((entry) => normaliseIp(entry) === target);
}
