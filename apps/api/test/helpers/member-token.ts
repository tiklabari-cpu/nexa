/**
 * Minting a widget token for a customer the test created directly (tm 287.2).
 *
 * A bare `customer_id` no longer reaches its customer (ID-03 · K4): a returning
 * visitor is recognised by the member token their browser holds, and the only
 * other way in is the transition's one-time adoption of a customer from before
 * member tokens (`customers.member_adoptable_until`). A suite that seeds a
 * customer row and then wants "that visitor's widget" takes that same
 * production path rather than a back door: open the customer's adoption window
 * and mint with the bare id — what a widget from before member tokens does on
 * its first load after the change. The answer is the customer token *and* the
 * member token for that customer; mint again with `member_token` to come back.
 */
import type { LightMyRequestResponse } from 'fastify';
import { withTenant } from '../../src/lib/tenant.js';
import type { TenantFixture } from './fixtures.js';
import type { TestServer } from './server.js';

export async function mintForExistingCustomer(
  server: TestServer,
  tenant: TenantFixture,
  customerId: string,
  options: { origin?: string; body?: Record<string, unknown> } = {},
): Promise<LightMyRequestResponse> {
  // The database's clock, like the check that reads it.
  const opened = await withTenant(
    server.app.db,
    { licenseId: tenant.licenseId, organizationId: tenant.organizationId },
    (tx) => tx.$executeRaw`
      UPDATE customers SET member_adoptable_until = clock_timestamp() + interval '1 hour'
      WHERE id = ${customerId}::uuid`,
  );
  if (opened !== 1) throw new Error(`customer ${customerId} is not in this tenant`);

  return server.post(
    '/customer/token',
    { organization_id: tenant.organizationId, customer_id: customerId, ...options.body },
    { origin: options.origin ?? `https://${tenant.trustedDomain}` },
  );
}
