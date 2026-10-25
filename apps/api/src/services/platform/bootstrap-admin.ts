/**
 * The first operator (tm 389.4 · FR-ADMIN-03).
 *
 * The root panel has no sign-up: every operator after the first is invited by
 * a superadmin. The first one cannot be — there is nobody to invite them — so
 * a person with shell access to the deployment creates them with
 * `platform:bootstrap-admin` (`bootstrap-admin-run.ts`). That command works
 * exactly once: once any operator exists, disabled ones included, it refuses,
 * so the CLI can never become a second door past the invitation and its
 * authenticator. The check and the insert share one transaction under an
 * advisory lock — two bootstraps started together produce one superadmin.
 *
 * The operator is created without an authenticator; the first sign-in is a
 * password-stage session that can only enroll one (`admin-auth.ts`).
 */
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../lib/crypto.js';
import { platformPasswordProblem } from './admin-auth.js';
import type { PlatformAuditLog } from './platform-audit.js';

const BOOTSTRAP_LOCK = 'siyahtus:platform:bootstrap';

/** A refusal the CLI prints as it is — no stack, exit 1. */
export class PlatformBootstrapRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformBootstrapRefused';
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface BootstrapInput {
  email: string;
  password: string;
  now?: Date;
  /**
   * Records `admin.bootstrapped` — the platform chain's first entry, in the
   * same transaction as the operator (tm 389.5). The CLI always passes it.
   */
  audit?: PlatformAuditLog;
}

export async function bootstrapPlatformAdmin(
  db: PrismaClient,
  input: BootstrapInput,
): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320) {
    throw new PlatformBootstrapRefused(`Not an e-mail address: ${input.email}`);
  }
  const problem = platformPasswordProblem(input.password);
  if (problem) throw new PlatformBootstrapRefused(problem);

  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_LOCK}))`;
    const existing = await tx.platformAdmin.count();
    if (existing > 0) {
      throw new PlatformBootstrapRefused(
        'An operator already exists. The first superadmin is created once; invite further operators from the root panel.',
      );
    }
    const admin = await tx.platformAdmin.create({
      data: {
        email,
        passwordHash,
        role: 'superadmin',
        ...(input.now ? { createdAt: input.now } : {}),
      },
      select: { id: true, email: true },
    });
    await input.audit?.record(
      {
        adminId: admin.id,
        action: 'admin.bootstrapped',
        targetType: 'admin',
        targetId: admin.id,
        payload: { email: admin.email, role: 'superadmin', via: 'cli' },
      },
      tx,
    );
    return admin;
  });
}

/**
 * The password the CLI was given: `PLATFORM_BOOTSTRAP_PASSWORD`, or the first
 * line on stdin. Windows terminals and `echo` both leave a `\r` or `\n` on it,
 * and a password that silently ends in one is a password nobody can type.
 */
export function cleanPasswordInput(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.replace(/\r$/, '');
}

export interface BootstrapArgs {
  email: string;
}

export function parseBootstrapArgs(argv: string[]): BootstrapArgs {
  let email: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--email') email = argv[++i];
    else if (arg.startsWith('--email=')) email = arg.slice('--email='.length);
    else throw new PlatformBootstrapRefused(`Unknown argument: ${arg}`);
  }
  if (!email)
    throw new PlatformBootstrapRefused('Usage: platform:bootstrap-admin --email <address>');
  return { email };
}
