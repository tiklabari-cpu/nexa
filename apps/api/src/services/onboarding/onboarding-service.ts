/**
 * First-run setup (FR-MOD-00.4).
 *
 * Signup creates an empty workspace, so a brand-new owner would otherwise land
 * on a blank inbox. Two license-level flags carry the state: `onboardingCompletedAt`
 * (the owner finished or skipped the wizard) and `demoSeededAt` (sample data was
 * laid down). Both are per-license — the workspace is set up, not each agent —
 * so the wizard gates once for the whole workspace.
 *
 * The sample data goes through the `onboarding_seed_demo` SECURITY DEFINER
 * function rather than a hand-written multi-table insert here: it writes an
 * org-scoped visitor alongside license-scoped chats/threads/events as one atomic,
 * reviewable unit that takes the tenant ids explicitly and writes only those.
 * The short chat/thread ids are minted here — the app owns the id format — and
 * passed in.
 */
import { generateShortId } from '@nexa/types';
import type { OnboardingSeedResult, OnboardingState } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { TenantContext } from '../../lib/tenant.js';

interface LicenseFlags {
  onboardingCompletedAt: Date | null;
  demoSeededAt: Date | null;
}

function toState(flags: LicenseFlags): OnboardingState {
  return {
    completed: flags.onboardingCompletedAt !== null,
    completed_at: flags.onboardingCompletedAt?.toISOString() ?? null,
    demo_seeded: flags.demoSeededAt !== null,
    demo_seeded_at: flags.demoSeededAt?.toISOString() ?? null,
  };
}

export class OnboardingService {
  /** The current workspace's setup state. */
  async getState(tx: TenantClient, licenseId: bigint): Promise<OnboardingState> {
    const flags = await this.#flags(tx, licenseId);
    return toState(flags);
  }

  /**
   * Mark setup finished or skipped — the outcome is the same either way. Only
   * writes the timestamp the first time, so a second call (or a re-mounted
   * wizard) keeps the original completion time rather than resetting it.
   */
  async complete(tx: TenantClient, licenseId: bigint): Promise<OnboardingState> {
    await tx.license.updateMany({
      where: { id: licenseId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date() },
    });
    return this.getState(tx, licenseId);
  }

  /**
   * Lay down sample data for the workspace. Idempotent: the function no-ops when
   * `demoSeededAt` is already set and reports `seeded: false` with zero counts.
   */
  async seedDemo(
    tx: TenantClient,
    tenant: TenantContext,
    ownerId: string,
  ): Promise<OnboardingSeedResult> {
    const chatId = generateShortId();
    const threadId = generateShortId();

    const rows = await tx.$queryRaw<
      Array<{ seeded: boolean; canned: number; tags: number; customers: number; chats: number }>
    >`SELECT * FROM onboarding_seed_demo(
        ${tenant.licenseId}, ${tenant.organizationId}::uuid, ${ownerId}::uuid,
        ${chatId}, ${threadId})`;

    const row = rows[0] ?? { seeded: false, canned: 0, tags: 0, customers: 0, chats: 0 };
    return {
      seeded: row.seeded,
      counts: {
        canned_responses: Number(row.canned),
        tags: Number(row.tags),
        customers: Number(row.customers),
        chats: Number(row.chats),
      },
      state: await this.getState(tx, tenant.licenseId),
    };
  }

  async #flags(tx: TenantClient, licenseId: bigint): Promise<LicenseFlags> {
    // RLS narrows this to the caller's organization; the id keeps it to the one
    // license even in the (unusual) case of an organization with several.
    const row = await tx.license.findUnique({
      where: { id: licenseId },
      select: { onboardingCompletedAt: true, demoSeededAt: true },
    });
    return {
      onboardingCompletedAt: row?.onboardingCompletedAt ?? null,
      demoSeededAt: row?.demoSeededAt ?? null,
    };
  }
}
