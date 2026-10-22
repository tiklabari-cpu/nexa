/**
 * The permission matrix's store (RL-02 · tm 325.2): reading a workspace's
 * choices, changing them, and what a change owes the trail and the admins.
 *
 * The rules — the catalogue, how a role plus the stored rows resolves, which
 * cells are locked — are `@siyahtus/types`' (`capabilities.ts`), so the REST
 * edge and the RTM gateway reach the same answer; the cache and the version
 * semantics are `permission-matrix.ts` beside them. This file is the database
 * half.
 *
 * A change runs in one tenant transaction, in this order:
 *
 *   1. lock the licence row (`FOR UPDATE`) — two saves of one workspace's
 *      matrix queue here, so each reads the rows the other committed and the
 *      trail's `from` is what the cell really held;
 *   2. read the stored rows and apply the changes to them: a cell set to its
 *      default loses its row (the matrix stores choices, not copies of the
 *      catalogue — a later change of default reaches every workspace that
 *      never chose otherwise), any other value is upserted, a locked cell is
 *      left alone (the validator only lets its own value through);
 *   3. bump `licenses.permissions_version` if a row moved;
 *   4. read the matrix back and, if a row moved, audit every cell whose
 *      resolved value moved, with the reason.
 *
 * Announcing the change and mailing the admins happen after the commit, in the
 * route: before it, a process could re-read the old rows and keep them.
 */
import type { PrismaClient } from '@prisma/client';
import {
  AGENT_ROLES,
  CAPABILITIES,
  MATRIX_ROLES,
  capabilitiesForRole,
  capabilityChangeProblem,
  capabilityDefinition,
  capabilityLock,
  matrixRoleFor,
  permissionMatrixFromRows,
  type CapabilityChangeProblem,
  type CapabilityDefinition,
  type CapabilityGroup,
  type CapabilityKey,
  type CapabilityLock,
  type CapabilityOverride,
  type CapabilityValue,
  type MatrixRole,
  type PermissionMatrixRow,
  type PermissionMatrixSnapshot,
  type PermissionMatrixTenant,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';

const CATALOGUE = CAPABILITIES as readonly CapabilityDefinition[];

/**
 * The version and the rows in **one statement**, so they describe the same
 * matrix: two reads could straddle a commit and label the new rows with the
 * old version, which a cache would then keep as current.
 */
export async function readPermissionMatrix(
  tx: TenantClient,
  licenseId: bigint,
): Promise<PermissionMatrixSnapshot> {
  // The RTM gateway runs this same statement (`apps/rtm/src/permissions.ts`).
  const rows = await tx.$queryRaw<PermissionMatrixRow[]>`
    SELECT l.permissions_version AS version, o.role, o.capability, o.value
      FROM licenses l
      LEFT JOIN role_capability_overrides o ON o.license_id = l.id
     WHERE l.id = ${licenseId}
     ORDER BY o.role, o.capability`;
  return permissionMatrixFromRows(rows);
}

/**
 * The cache's loader: read-only (it runs on every request's path once the
 * sessions read the matrix, including inside a simulation), on the primary —
 * a replica's lag would label old rows with a version the reader trusts.
 */
export function prismaPermissionMatrixLoader(
  db: PrismaClient,
): (tenant: PermissionMatrixTenant) => Promise<PermissionMatrixSnapshot> {
  return ({ licenseId, organizationId }) =>
    // Licence and organization only: the matrix is licence-wide, and a brand a
    // caller happens to carry must not shape what the cache keeps for everyone.
    withTenant(db, { licenseId, organizationId }, (tx) => readPermissionMatrix(tx, licenseId), {
      readOnly: true,
    });
}

export interface PermissionCellBody {
  role: MatrixRole;
  value: CapabilityValue;
  default: CapabilityValue;
  lock: CapabilityLock | null;
}

export interface PermissionMatrixBody {
  version: number;
  roles: MatrixRole[];
  capabilities: Array<{
    key: string;
    group: CapabilityGroup;
    values: CapabilityValue[];
    floor_role: MatrixRole;
    owner_only: boolean;
    cells: PermissionCellBody[];
  }>;
}

type ResolvedMatrix = Record<MatrixRole, Record<CapabilityKey, CapabilityValue>>;

function resolve(overrides: readonly CapabilityOverride[]): ResolvedMatrix {
  const out = {} as ResolvedMatrix;
  for (const role of MATRIX_ROLES) out[role] = capabilitiesForRole(role, overrides);
  return out;
}

/** `GET`/`PUT /settings/permissions`' body. */
export function serialisePermissionMatrix(
  snapshot: PermissionMatrixSnapshot,
): PermissionMatrixBody {
  const resolved = resolve(snapshot.overrides);
  return {
    version: snapshot.version,
    roles: [...MATRIX_ROLES],
    capabilities: CATALOGUE.map((definition) => ({
      key: definition.key,
      group: definition.group,
      values: [...definition.values],
      floor_role: definition.floorRole,
      owner_only: definition.ownerOnly === true,
      cells: MATRIX_ROLES.map((role) => ({
        role,
        value: resolved[role][definition.key as CapabilityKey],
        default: definition.defaults[role],
        lock: capabilityLock(definition, role),
      })),
    })),
  };
}

/** One cell that moved: what the trail and the admins' mail say. */
export interface PermissionCellChange {
  role: MatrixRole;
  capability: CapabilityKey;
  from: CapabilityValue;
  to: CapabilityValue;
}

/** Every cell whose resolved value differs, in catalogue order then column order. */
export function permissionMatrixDiff(
  before: readonly CapabilityOverride[],
  after: readonly CapabilityOverride[],
): PermissionCellChange[] {
  const was = resolve(before);
  const is = resolve(after);
  const changes: PermissionCellChange[] = [];
  for (const definition of CATALOGUE) {
    const key = definition.key as CapabilityKey;
    for (const role of MATRIX_ROLES) {
      if (was[role][key] !== is[role][key]) {
        changes.push({ role, capability: key, from: was[role][key], to: is[role][key] });
      }
    }
  }
  return changes;
}

export interface PermissionChangeInput {
  role: string;
  capability: string;
  value: string;
}

export interface PermissionChangeRefusal {
  reason: CapabilityChangeProblem | 'duplicate_change';
  role: string;
  capability: string;
}

const cellKey = (role: string, capability: string): string => `${role} ${capability}`;

/**
 * The first change the PUT must refuse, or null. The whole request is refused
 * on one: a half-applied matrix is a state nobody chose.
 */
export function permissionChangeRefusal(
  changes: readonly PermissionChangeInput[],
): PermissionChangeRefusal | null {
  const seen = new Set<string>();
  for (const change of changes) {
    const problem = capabilityChangeProblem(change);
    if (problem) return { reason: problem, role: change.role, capability: change.capability };
    const key = cellKey(change.role, change.capability);
    if (seen.has(key)) {
      return { reason: 'duplicate_change', role: change.role, capability: change.capability };
    }
    seen.add(key);
  }
  return null;
}

export interface AppliedPermissionChanges {
  snapshot: PermissionMatrixSnapshot;
  /** Cells whose resolved value moved — empty when the request changed nothing. */
  changes: PermissionCellChange[];
  /** Whether a stored row moved, and so the version. */
  versionBumped: boolean;
}

/**
 * Apply already-validated `changes` ({@link permissionChangeRefusal} said
 * null) to `licenseId`'s matrix, inside the caller's tenant transaction.
 */
export async function applyPermissionChanges(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    actorId: string | null;
    changes: readonly PermissionChangeInput[];
    reason: string;
    audit: AuditContext;
  },
): Promise<AppliedPermissionChanges> {
  const { licenseId } = input;
  // The lock every save of this workspace's matrix queues on — taken before
  // the rows are read, so the `from` this save records is what the previous
  // save committed.
  const locked = await tx.$queryRaw<Array<{ version: number }>>`
    SELECT permissions_version AS version FROM licenses WHERE id = ${licenseId} FOR UPDATE`;
  if (locked.length === 0) throw new Error(`licence ${licenseId.toString()} is not visible`);

  const before = await tx.roleCapabilityOverride.findMany({
    where: { licenseId },
    select: { role: true, capability: true, value: true },
  });
  const stored = new Map(before.map((row) => [cellKey(row.role, row.capability), row.value]));

  const upserts: PermissionChangeInput[] = [];
  const deletes: Array<{ role: string; capability: string }> = [];
  for (const change of input.changes) {
    const definition = capabilityDefinition(change.capability);
    if (!definition) continue;
    const role = change.role as MatrixRole;
    // A locked cell passed validation only with the value it already holds.
    if (capabilityLock(definition, role) !== null) continue;
    const existing = stored.get(cellKey(role, change.capability));
    if (change.value === definition.defaults[role]) {
      if (existing !== undefined) deletes.push({ role, capability: change.capability });
    } else if (existing !== change.value) {
      upserts.push(change);
    }
  }

  if (deletes.length > 0) {
    await tx.$executeRaw`
      DELETE FROM role_capability_overrides
       WHERE license_id = ${licenseId}
         AND (role, capability) IN (
           SELECT * FROM unnest(${deletes.map((d) => d.role)}::text[],
                                ${deletes.map((d) => d.capability)}::text[]))`;
  }
  if (upserts.length > 0) {
    await tx.$executeRaw`
      INSERT INTO role_capability_overrides
             (license_id, role, capability, value, updated_by, updated_at)
      SELECT ${licenseId}, t.role, t.capability, t.value, ${input.actorId}::uuid, now()
        FROM unnest(${upserts.map((u) => u.role)}::text[],
                    ${upserts.map((u) => u.capability)}::text[],
                    ${upserts.map((u) => u.value)}::text[]) AS t(role, capability, value)
      ON CONFLICT (license_id, role, capability) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at`;
  }
  const versionBumped = deletes.length + upserts.length > 0;
  if (versionBumped) {
    await tx.$executeRaw`
      UPDATE licenses SET permissions_version = permissions_version + 1 WHERE id = ${licenseId}`;
  }

  // Read back rather than assembled: the response and the trail say what is
  // stored, not what this function meant to store.
  const snapshot = await readPermissionMatrix(tx, licenseId);
  const changes = permissionMatrixDiff(before, snapshot.overrides);
  // Whenever a row moved — not only when a resolved value did. The two differ
  // only for a stored row the resolution was already ignoring (one the PUT
  // would refuse, written some other way) that a save to its default removed:
  // no cell changes, but the table and the version did, and the trail says so
  // with an empty `changes` and the row counts.
  if (versionBumped) {
    await writeAuditEntry(tx, input.audit, {
      action: 'permissions.changed',
      target: `permissions:${licenseId.toString()}`,
      metadata: {
        version: snapshot.version,
        changes,
        rows_written: upserts.length,
        rows_removed: deletes.length,
        reason: input.reason,
      },
    });
  }
  return { snapshot, changes, versionBumped };
}

/** The roles the Yönetici column holds — today `admin`, and `viceowner` until it is retired. */
export const PERMISSION_NOTICE_ROLES = AGENT_ROLES.filter(
  (role) => matrixRoleFor(role) === 'admin',
);

export interface PermissionNotice {
  workspaceName: string;
  actorName: string;
  recipients: Array<{ email: string; locale: MailLocale }>;
}

/**
 * Who hears of a change (RL-02-S5: "Yöneticilere bildirim") and what the mail
 * names: every active Yönetici with mail switched on. Read in the change's
 * transaction, so the list is the one that stood when the matrix moved.
 */
export async function readPermissionNotice(
  tx: TenantClient,
  input: { licenseId: bigint; organizationId: string; actorId: string },
): Promise<PermissionNotice> {
  const [members, organization, actor] = await Promise.all([
    tx.agentMembership.findMany({
      where: {
        licenseId: input.licenseId,
        role: { in: [...PERMISSION_NOTICE_ROLES] },
        suspended: false,
        awaitingApproval: false,
        notifyEmail: true,
      },
      orderBy: { createdAt: 'asc' },
      select: { locale: true, agent: { select: { email: true } } },
    }),
    tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true },
    }),
    tx.account.findUnique({ where: { id: input.actorId }, select: { name: true, email: true } }),
  ]);
  const recipients: PermissionNotice['recipients'] = [];
  for (const member of members) {
    const email = member.agent.email;
    if (email)
      recipients.push({ email, locale: isMailLocale(member.locale) ? member.locale : 'en' });
  }
  return {
    workspaceName: organization?.name ?? 'SiyahTuş',
    actorName: actor?.name ?? actor?.email ?? 'SiyahTuş',
    recipients,
  };
}
