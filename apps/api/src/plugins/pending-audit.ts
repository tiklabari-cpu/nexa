/**
 * Signs, at boot, the audit entries a migration left pending (tm 324.3).
 *
 * A migration cannot chain an audit entry — the key is the application's — so
 * one that changes something the trail must show records the entry in
 * `pending_audit_entries`, and the first API process to boot after it signs
 * them (`services/audit/pending-audit.ts`). Every deployment shape reaches
 * this: the image migrates and then starts the app (`docker-entrypoint.sh`),
 * and the Helm chart's migrate Job runs before the new pods start.
 *
 * Awaited, so a server is ready only once the pass has finished — a request
 * cannot meet the trail half-signed, and a test cannot truncate tables under
 * it. Never fatal, like the partition pass in `plugins/database.ts`: a
 * workspace whose entries could not be signed is logged at `error` and its
 * entries wait for the next boot; refusing to start would stop the product
 * over a record of a change that has already happened.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { signPendingAuditEntries } from '../services/audit/pending-audit.js';

async function pendingAuditPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const log = app.log.child({ component: 'pending-audit' });
  try {
    const report = await signPendingAuditEntries(app.db, {
      chainSecret: options.env.AUDIT_CHAIN_SECRET,
    });
    for (const failure of report.failed) {
      log.error(
        { license_id: failure.licenseId.toString(), err: failure.error },
        'pending audit entries not signed; they stay pending until the next boot',
      );
    }
    if (report.tenants > 0) {
      log.info(
        { tenants: report.tenants, signed: report.signed, failed: report.failed.length },
        'signed pending audit entries',
      );
    }
  } catch (error) {
    log.error(
      { err: error },
      'pending audit entries could not be listed; retried at the next boot',
    );
  }
}

export default fp(pendingAuditPlugin, { name: 'pending-audit', dependencies: ['database'] });
