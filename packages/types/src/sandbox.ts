/**
 * The sandbox workspace (FR-MOD-11.5, PRD §5.4 "Kurumsal").
 *
 * A place to point an integration at, replay a migration in, or hand to a new
 * hire — shaped exactly like production and connected to none of it. It is a
 * **second tenant**, not a mode: its own organization, its own licence, its own
 * row level security scope. The only thread back is
 * `licenses.sandbox_of_license_id`, and that thread exists so three commercial
 * questions have one answer — a sandbox is not metered, not invoiced, and its
 * members are not seats on the parent's bill.
 *
 * **What a sandbox does not inherit is its plan.** It holds no subscription, so
 * it reads as the self-serve tier and the Enterprise controls (SSO, SIEM
 * export, white label, SLA targets, HIPAA) are refused inside it exactly as
 * they would be on any unpaid workspace. That is a real limitation, named
 * rather than hidden: inheriting would mean a sandbox credential reading the
 * parent licence's subscription, which is the one thing this slice exists to
 * make impossible. It is also what stops a sandbox creating a sandbox.
 */
import type { Region } from './domain.js';

/**
 * The sandbox belonging to a production licence, as its owner sees it.
 *
 * Deliberately thin. Everything here is read from the *sandbox's licence row*,
 * which the parent can see through one narrow addition to `licenses_tenant`;
 * nothing is read from the sandbox's organization, its members or its data, so
 * the view costs no widening beyond that single row.
 *
 * There is no name. A workspace is opened by choosing it at sign-in, where
 * `/auth/login` already lists it with its organization's name, and duplicating
 * that here would mean reading a second organization's row for a label the
 * client is about to be handed anyway.
 */
export interface SandboxSummary {
  /** The sandbox's licence id — what a client passes to `/auth/authorize`. */
  license_id: string;
  /**
   * Where the sandbox's data lives. Inherited from the parent and immutable
   * (C4-a), so it always equals the caller's own region; reported anyway
   * because "my test data went somewhere else" is the fear this answers.
   */
  region: Region;
  created_at: string;
  /** When it was last wiped, or null if never. */
  reset_at: string | null;
}

/**
 * What `GET /settings/sandbox` reports.
 *
 * Three states the screen has to tell apart, which is why `entitled` is here
 * beside `sandbox` rather than being inferred from it: a workspace that has not
 * bought the capability, one that has bought it and not used it, and one with a
 * sandbox already. The same "not bought" / "not set" distinction `GET
 * /settings/sla` draws with `active`.
 *
 * `is_sandbox` answers it from the inside: read with a credential for the
 * sandbox itself, this is the only field that is true, and it is what the
 * console renders "you are in a sandbox" from. It reports nothing about the
 * parent — not its id, not its plan, not that it exists.
 */
export interface SandboxView {
  /** True when the *caller's own* licence is a sandbox. */
  is_sandbox: boolean;
  /** Whether this licence's plan includes a sandbox at all. */
  entitled: boolean;
  /** This licence's sandbox, or null when it has none (and inside one). */
  sandbox: SandboxSummary | null;
}
