/**
 * Two-factor authentication, in a browser (NFR-S11 · FR-MOD-00.1 · S11-2FA-i).
 *
 * Every piece of this shipped with its own proof: `totp.test.ts` runs the RFC
 * 6238 vectors, `two-factor-{enrollment,enforcement,recovery-codes}.test.ts`
 * drive the endpoints in-process, `TwoFactor.test.tsx` renders the settings
 * screen against a mocked client. None of them can fail the way this feature
 * actually fails a person: the secret shown on one screen never reaching the
 * code box on another, a wrong code bouncing back to the password step and
 * losing the attempt, a recovery code that works twice because the browser
 * re-posted it, a policy that shuts somebody out with nothing on screen saying
 * why. Those live in the seams between screens, and the seams are what this
 * walks.
 *
 * TWO FRESH WORKSPACES, NOT THE SEEDED ONE. A second factor is account-wide
 * (PRD §8.4 — one account, many memberships), so enabling it on
 * `owner@acme.localhost` would put a code step in front of `fixtures.signIn`
 * for every spec that runs afterwards, and `require_two_factor` on Acme would
 * shut that owner out of the workspace the rest of the suite reads. tm 147's
 * rule is to give back what you borrow; the cheaper answer here is to borrow
 * nothing. Each test signs up its own workspace through the public form, so the
 * only rows it can damage are its own. That also makes the credentials this
 * file puts in `kanit/` — a setup key and a recovery sheet — throwaway by
 * construction: they belong to an account created and abandoned inside one run
 * of a local test database.
 *
 * THE AUTHENTICATOR IS WRITTEN OUT HERE rather than imported from
 * `apps/api/src/lib/totp.ts`. `@nexa/e2e` has no workspace dependencies (see
 * its `package.json`), so importing would mean exporting the API's internals to
 * a test package — but the stronger reason is that a shared implementation
 * cannot catch its own bug: a base32 decoder that dropped a bit would produce
 * codes this suite accepted and every real authenticator app rejected. Forty
 * lines of RFC 4226 written independently is the second opinion the seam needs.
 */
import { createHmac } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { API_BASE, expect, ownerAccessTokenFor, test } from './fixtures.js';

/** One password for every workspace this file creates; none of them outlive the run. */
const PASSWORD = 'two-factor-e2e-password';

// --- An authenticator app, in about forty lines -----------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

function base32Decode(secret: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const symbol of secret.replace(/[\s=-]/g, '').toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(symbol);
    expect(value, `setup key is not RFC 4648 base32: ${symbol}`).toBeGreaterThanOrEqual(0);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** HMAC-SHA1 over the step counter, dynamically truncated — RFC 4226 §5.3. */
function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function stepNow(): number {
  return Math.floor(Date.now() / STEP_MS);
}

interface Authenticator {
  /** A code for a step this account has never spent. */
  next: () => Promise<string>;
  /** Six digits that are not a live code for any step the server would accept. */
  wrong: () => string;
}

function authenticator(secret: string): Authenticator {
  let spent = -1;

  return {
    async next(): Promise<string> {
      // Never the same step twice. `verifyTotp` refuses any step at or before
      // the last one it accepted (RFC 6238 §5.2), so the code that activated
      // the factor cannot also open a session — which is the point, and would
      // otherwise read here as a random failure whenever the whole journey fit
      // inside one 30-second window. One step ahead is inside the ±1 drift the
      // server tolerates; two would be refused, so wait for the clock rather
      // than hand over a code that cannot work.
      let step = Math.max(stepNow(), spent + 1);
      while (step > stepNow() + 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        step = Math.max(stepNow(), spent + 1);
      }
      spent = step;
      return codeForStep(secret, step);
    },

    wrong(): string {
      // Chosen against the live window rather than assumed: `000000` is a real
      // code roughly three times in a million, and a test that fails that
      // rarely is worse than one that never does.
      const live = new Set<string>();
      for (let step = stepNow() - 2; step <= stepNow() + 2; step += 1) {
        live.add(codeForStep(secret, step));
      }
      for (let candidate = 0; candidate < 1_000; candidate += 1) {
        const digits = candidate.toString().padStart(6, '0');
        if (!live.has(digits)) return digits;
      }
      throw new Error('unreachable: 1000 candidates cannot all be live codes');
    },
  };
}

// --- A workspace of this test's own -----------------------------------------

interface FreshOwner {
  email: string;
  password: string;
  workspace: string;
}

/**
 * Sign up through the public form and leave the first-run wizard behind.
 *
 * `fixtures.signUpFreshOwner` stops at the wizard and keeps its password to
 * itself; both halves matter here, because everything below signs the same
 * person back in by hand. Skipping is the product's own exit
 * (`POST /onboarding/complete`) — until it is taken, `App.tsx` sends every path
 * to the wizard and Settings cannot be reached at all.
 */
async function signUpAndEnterTheApp(page: Page, label: string): Promise<FreshOwner> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const owner: FreshOwner = {
    email: `owner-${label}-${unique}@two-factor.test`,
    password: PASSWORD,
    workspace: `Two Factor ${label} ${unique}`,
  };

  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(owner.workspace);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

  return owner;
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  // The password box is the sign-in screen's own proof; the rail is gone.
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
}

/**
 * The first leg of a sign-in: the credentials, and nothing else.
 *
 * `exact`, because the code step below carries a "Back to sign in" button whose
 * accessible name contains this one.
 */
async function submitPassword(page: Page, owner: FreshOwner): Promise<void> {
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Swap the code box for the recovery sheet.
 *
 * A real pointer click, not keyboard activation — that used to be the only way
 * in (tm 152.12): the code box is `autoFocus`ed, so a mousedown here blurred it,
 * the empty field earned its "Enter your code." line, `FieldError` inserted a
 * paragraph, and the button moved down the page before mouseup landed. This
 * click proves that race is closed (`SignInPage` now reserves the error's slot
 * whether or not it has a message) — a regression would bring this test back to
 * the same "button focused, mode unchanged" failure the handoff measured.
 */
async function useRecoverySheet(codeStep: Locator): Promise<void> {
  await codeStep.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await expect(codeStep.getByLabel('Recovery code')).toBeVisible();
}

test.describe('two-factor authentication', () => {
  test('an agent sets up a second factor, and from then on it decides who gets in', async ({
    page,
  }) => {
    // Six sign-ins, four of them through the code step, plus a possible wait on
    // the 30-second TOTP clock.
    test.setTimeout(180_000);

    const owner = await signUpAndEnterTheApp(page, 'journey');

    // --- 1. Enable it, from the account settings screen ----------------------
    await page.goto('/app/settings');
    const section = page.getByRole('region', { name: 'Two-factor authentication' });
    await expect(
      section.getByText('Your account currently signs in with a password alone.'),
    ).toBeVisible();
    await section.getByRole('button', { name: 'Enable two-factor authentication' }).click();

    const setup = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
    const secret = ((await setup.locator('code').first().textContent()) ?? '').trim();
    const otpauthUri = ((await setup.locator('code').nth(1).textContent()) ?? '').trim();
    expect(secret, 'no setup key on screen').not.toBe('');
    // The key a person types into their app and the URI that app imports have
    // to be the same key. If they ever drift, enrollment "works" and every code
    // the app produces afterwards is wrong, with nothing anywhere to say why.
    expect(otpauthUri).toContain(`secret=${secret}`);
    await setup.screenshot({ path: 'kanit/S11-2FA-enrollment.png' });

    const app = authenticator(secret);
    await setup.getByLabel('Authentication code').fill(await app.next());
    await setup.getByRole('button', { name: 'Verify & activate' }).click();

    // --- 2. The recovery sheet, shown once -----------------------------------
    const sheet = page.getByRole('dialog', { name: 'Save your recovery codes' });
    await expect(sheet).toBeVisible();
    const recoveryCodes = (await sheet.locator('code').allTextContents()).map((code) =>
      code.trim(),
    );
    expect(recoveryCodes).toHaveLength(10);
    await sheet.screenshot({ path: 'kanit/S11-2FA-recovery-codes.png' });

    await sheet.getByLabel('I have saved these codes somewhere safe.').check();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(section.getByText('10 recovery codes left')).toBeVisible();

    // --- 3. Sign out, and the password alone no longer finishes the job ------
    await signOut(page);
    await submitPassword(page, owner);

    const codeStep = page.getByRole('region', { name: 'Enter your code' });
    await expect(codeStep).toBeVisible();
    await expect(codeStep).toContainText(owner.workspace);

    // --- 4. A wrong code is refused, right where it was typed ----------------
    // Six digits submit themselves (S11-2FA-g), so filling the box is the whole
    // attempt. The refusal has to stay on this screen: bouncing back to the
    // password step would spend a correct password on a retry that does not
    // need it, and would read as "your password was wrong", which it was not.
    await codeStep.getByLabel('Authentication code').fill(app.wrong());
    await expect(codeStep.getByText('That code is not right. Try again.')).toBeVisible();
    await expect(codeStep.getByLabel('Authentication code')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
    await page.screenshot({ path: 'kanit/S11-2FA-code-step.png', fullPage: true });

    // --- 5. The right code, from the same screen -----------------------------
    await codeStep.getByLabel('Authentication code').fill(await app.next());
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

    // --- 6. A recovery code is the other way in ------------------------------
    await signOut(page);
    await submitPassword(page, owner);
    await expect(codeStep).toBeVisible();
    await useRecoverySheet(codeStep);
    await codeStep.getByLabel('Recovery code').fill(recoveryCodes[0]!);
    await codeStep.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

    // --- 7. And it is gone the moment it has been used -----------------------
    await signOut(page);
    await submitPassword(page, owner);
    await expect(codeStep).toBeVisible();
    await useRecoverySheet(codeStep);
    await codeStep.getByLabel('Recovery code').fill(recoveryCodes[0]!);
    await codeStep.getByRole('button', { name: 'Verify' }).click();
    await expect(codeStep.getByText('That code is not right. Try again.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);

    // The refusal above has to be about that one code, not about the sheet: a
    // recovery login that quietly burned all ten would produce exactly the same
    // screen, and would be a far worse defect. A second code, typed into the
    // same box, is what tells the two apart.
    await codeStep.getByLabel('Recovery code').fill(recoveryCodes[1]!);
    await codeStep.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

    // Two spent, eight left — the count the settings screen warns from.
    await page.goto('/app/settings');
    await expect(section.getByText('8 recovery codes left')).toBeVisible();
  });

  test('a workspace that requires a second factor sends a member who has none to set one up', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    const owner = await signUpAndEnterTheApp(page, 'policy');

    // Minted before the policy goes on, because afterwards `/auth/authorize`
    // refuses this account too — that is the whole point of the test. It is the
    // only way back in, and the last step uses it to reopen the door rather
    // than leave behind a workspace nobody can enter.
    const token = await ownerAccessTokenFor(request, {
      email: owner.email,
      password: owner.password,
      orgPrefix: owner.workspace,
    });

    // --- The switch, from Settings → Session policy --------------------------
    await page.goto('/app/settings');
    const policy = page.getByRole('region', { name: 'Session policy' });
    // `click`, not `check`: the box is controlled by the saved setting, and
    // ticking it opens the confirmation instead of changing anything. It only
    // moves once the server has said yes, which is the behaviour under test.
    await policy.getByLabel('Require two-factor authentication').click();

    const confirm = page.getByRole('dialog', { name: 'Require two-factor authentication?' });
    // The count is the reason the confirmation exists: it names how many people
    // this is about to ask something of. In a workspace of one, that is the
    // person reading it.
    await expect(confirm).toContainText('1 of 1 teammate has not set up two-factor yet.');
    await confirm.getByRole('button', { name: 'Require two-factor' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(policy.getByLabel('Require two-factor authentication')).toBeChecked();

    // Nobody is signed out by the switch (S11-2FA-e) — it is the *next* sign-in
    // that asks.
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

    // --- The next sign-in ----------------------------------------------------
    await signOut(page);
    await submitPassword(page, owner);

    const enrollment = page.getByRole('region', { name: 'Set up two-factor authentication' });
    await expect(enrollment).toBeVisible();
    await expect(enrollment).toContainText(owner.workspace);
    // No code box, because no code could satisfy it: this account has no factor
    // to produce one with.
    await expect(page.getByRole('region', { name: 'Enter your code' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
    await page.screenshot({ path: 'kanit/S11-2FA-enrollment-required.png', fullPage: true });

    // The door out of the policy's own dead end (S11-2FA-k). Until it existed
    // this panel could only point at Account Settings, which is behind the
    // sign-in that just refused — a link to a locked room. The refusal now
    // carries a credential good for the two enrollment endpoints, and the only
    // way to know it actually reaches the server is to press the button in a
    // browser holding no session at all: nothing in this tab is signed in, so
    // if the ticket were not being sent, or were being sent as anything but a
    // bearer token, the setup key below would never arrive.
    await enrollment.getByRole('button', { name: 'Set it up now' }).click();
    await expect(enrollment.getByText(/^[A-Z2-7]{32}$/)).toBeVisible();
    await expect(enrollment.getByLabel('Authentication code')).toBeVisible();
    await page.screenshot({ path: 'kanit/S11-2FA-enrollment-ticket.png', fullPage: true });

    // --- Give the workspace back ---------------------------------------------
    // And prove it was the policy that closed the door: with the setting off,
    // the same password opens it again on the next try.
    const reopened = await request.patch(`${API_BASE}/settings/security`, {
      headers: { authorization: `Bearer ${token}` },
      data: { require_two_factor: false },
    });
    expect(
      reopened.ok(),
      `could not turn the policy back off: ${reopened.status()} ${await reopened.text()}`,
    ).toBe(true);

    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await submitPassword(page, owner);
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
  });
});
