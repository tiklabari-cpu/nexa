/**
 * Settings › Security › Member recognition (ID-03 · tm 287.5): the saved
 * lifetime lands in the form, only what changed is PATCHed, the bounds are held
 * before the network, the key is described and never shown, a rotation and the
 * bulk "forget everyone" both ask first (and say what a zero grace window
 * does), and a caller without `access_rules:rw` gets a read-only screen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberRecognition } from './MemberRecognition.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const DAY = 86_400;

interface View {
  token_ttl_seconds: number;
  possible_matches_enabled: boolean;
  key: {
    version: number;
    created_at: string;
    previous_version: number | null;
    previous_valid_until: string | null;
  } | null;
  tokens_revoked_before: string | null;
  signed_identity: {
    enabled: boolean;
    active: boolean;
    secret: {
      version: number;
      created_at: string;
      previous_version: number | null;
      previous_valid_until: string | null;
    } | null;
    recent: { days: number; verified: number; refused: Record<string, number> } | null;
  };
  updated_at: string | null;
}

const DEFAULTS: View = {
  token_ttl_seconds: 30 * DAY,
  possible_matches_enabled: true,
  key: null,
  tokens_revoked_before: null,
  signed_identity: {
    enabled: false,
    active: false,
    secret: null,
    recent: { days: 7, verified: 0, refused: {} },
  },
  updated_at: null,
};

/** What the issuing response carries, this once. */
const ISSUED_SECRET = 'sti_shown-once-in-the-dialog-0123456789abcdefgh';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function errorJson(status: number, message: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({ error: { type: 'validation', message, request_id: 'req_test' } }),
  } as unknown as Response;
}

let current: View;
let patches: Array<Record<string, unknown>>;
let rotations: Array<Record<string, unknown>>;
let revocations: number;
let nextRotateFails: boolean;
let issues: Array<Record<string, unknown>>;

function stubFetch(view: View): void {
  current = view;
  patches = [];
  rotations = [];
  revocations = 0;
  nextRotateFails = false;
  issues = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = new URL(String(url), 'http://localhost').pathname;
      if (path.endsWith('/settings/member-recognition') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patches.push(body);
        const { signed_identity_enabled: enabled, ...rest } = body;
        current = {
          ...current,
          ...rest,
          ...(typeof enabled === 'boolean'
            ? {
                signed_identity: {
                  ...current.signed_identity,
                  enabled,
                  active: enabled && current.signed_identity.secret !== null,
                },
              }
            : {}),
          updated_at: '2026-10-16T10:00:00.000Z',
        } as View;
        return okJson(current);
      }
      if (path.endsWith('/identity-secret') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        issues.push(body);
        const previous = current.signed_identity.secret;
        current = {
          ...current,
          signed_identity: {
            ...current.signed_identity,
            active: current.signed_identity.enabled,
            secret: {
              version: (previous?.version ?? 0) + 1,
              created_at: '2026-11-03T10:00:00.000Z',
              previous_version: previous && body['grace_period_seconds'] ? previous.version : null,
              previous_valid_until:
                previous && body['grace_period_seconds'] ? '2026-11-04T10:00:00.000Z' : null,
            },
          },
        };
        return okJson({ ...current, identity_secret: ISSUED_SECRET });
      }
      if (path.endsWith('/rotate-key') && method === 'POST') {
        if (nextRotateFails) return errorJson(500, 'The key store is busy.');
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        rotations.push(body);
        current = {
          ...current,
          key: {
            version: (current.key?.version ?? 0) + 1,
            created_at: '2026-10-16T10:05:00.000Z',
            previous_version: current.key?.version ?? null,
            previous_valid_until: current.key ? '2026-10-23T10:05:00.000Z' : null,
          },
        };
        return okJson(current);
      }
      if (path.endsWith('/revoke-all') && method === 'POST') {
        revocations += 1;
        current = { ...current, tokens_revoked_before: '2026-10-16T10:10:00.000Z' };
        return okJson(current);
      }
      return okJson(current);
    }),
  );
}

function renderScreen(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemberRecognition canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  stubFetch(DEFAULTS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('MemberRecognition', () => {
  it('reads a never-saved workspace as 30 days with possible matches on', async () => {
    renderScreen();

    expect(await screen.findByLabelText('Remember for')).toHaveValue(30);
    expect(screen.getByLabelText('Unit')).toHaveValue('days');
    expect(screen.getByRole('checkbox', { name: /Show possible matches/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a lifetime that is not a whole number of days in hours', async () => {
    stubFetch({ ...DEFAULTS, token_ttl_seconds: 36 * 3600 });
    renderScreen();

    expect(await screen.findByLabelText('Remember for')).toHaveValue(36);
    expect(screen.getByLabelText('Unit')).toHaveValue('hours');
  });

  it('saves the lifetime as whole seconds and sends only what changed', async () => {
    const user = userEvent.setup();
    renderScreen();

    const amount = await screen.findByLabelText('Remember for');
    await user.clear(amount);
    await user.type(amount, '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toStrictEqual({ token_ttl_seconds: 90 * DAY });
  });

  it('saves the possible-match switch alone', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('checkbox', { name: /Show possible matches/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toStrictEqual({ possible_matches_enabled: false });
  });

  it.each([
    ['0', 'days'],
    ['366', 'days'],
    ['12', 'hours'],
    ['1.5', 'days'],
  ])('refuses %s %s before it reaches the network', async (amountText, unit) => {
    const user = userEvent.setup();
    renderScreen();

    const amount = await screen.findByLabelText('Remember for');
    await user.selectOptions(screen.getByLabelText('Unit'), unit);
    await user.clear(amount);
    await user.type(amount, amountText);
    await user.tab();

    expect(await screen.findByText('Enter a whole number from 1 day to 365 days.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patches).toHaveLength(0);
  });

  it('accepts exactly 24 hours and exactly 365 days', async () => {
    const user = userEvent.setup();
    renderScreen();

    const amount = await screen.findByLabelText('Remember for');
    await user.selectOptions(screen.getByLabelText('Unit'), 'hours');
    await user.clear(amount);
    await user.type(amount, '24');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toStrictEqual({ token_ttl_seconds: DAY });

    await user.selectOptions(screen.getByLabelText('Unit'), 'days');
    await user.clear(amount);
    await user.type(amount, '365');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toStrictEqual({ token_ttl_seconds: 365 * DAY });
  });

  it('describes the key without showing one, and the previous key’s deadline', async () => {
    stubFetch({
      ...DEFAULTS,
      key: {
        version: 3,
        created_at: '2026-10-10T08:00:00.000Z',
        previous_version: 2,
        previous_valid_until: '2026-10-17T08:00:00.000Z',
      },
    });
    renderScreen();

    expect(await screen.findByText('Current version')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText(/Version 2, still accepted until/)).toBeVisible();
  });

  it('says there is no key yet', async () => {
    renderScreen();
    expect(await screen.findByText(/No key yet\./)).toBeVisible();
  });

  it('asks before rotating, then sends the grace window in seconds', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Rotate the key' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing key?' });
    expect(dialog).toHaveTextContent('still recognised for 7 days');
    expect(rotations).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    await waitFor(() => expect(rotations).toHaveLength(1));
    expect(rotations[0]).toStrictEqual({ grace_period_seconds: 7 * DAY });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Current version')).toBeVisible();
  });

  it('names the emergency rotation when the grace window is 0', async () => {
    const user = userEvent.setup();
    renderScreen();

    const grace = await screen.findByLabelText('Keep the old key for (days)');
    await user.clear(grace);
    await user.type(grace, '0');
    expect(screen.getByText(/0 retires the old key at once/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Rotate the key' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing key?' });
    expect(dialog).toHaveTextContent('starts again as a new visitor');
    await user.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    await waitFor(() => expect(rotations).toHaveLength(1));
    expect(rotations[0]).toStrictEqual({ grace_period_seconds: 0 });
  });

  it('holds the grace window to 0–30 days', async () => {
    const user = userEvent.setup();
    renderScreen();

    const grace = await screen.findByLabelText('Keep the old key for (days)');
    await user.clear(grace);
    await user.type(grace, '31');
    expect(screen.getByText('Enter a whole number from 0 to 30.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rotate the key' })).toBeDisabled();
  });

  it('keeps the dialog open and says so when the rotation is refused', async () => {
    const user = userEvent.setup();
    renderScreen();
    nextRotateFails = true;

    await user.click(await screen.findByRole('button', { name: 'Rotate the key' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing key?' });
    await user.click(within(dialog).getByRole('button', { name: 'Rotate key' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The key could not be rotated.',
    );
    expect(rotations).toHaveLength(0);
  });

  it('asks before forgetting every visitor, and shows when it last happened', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Forget all visitors' }));
    const dialog = screen.getByRole('dialog', { name: 'Forget every returning visitor?' });
    expect(dialog).toHaveTextContent('This cannot be undone.');
    expect(revocations).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Forget all visitors' }));
    await waitFor(() => expect(revocations).toBe(1));
    expect(await screen.findByText(/Last done/)).toBeVisible();
  });

  it('cancelling the dialog forgets nobody', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Forget all visitors' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Forget every returning visitor?' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    expect(revocations).toBe(0);
  });

  it('is read-only without write access: values shown, no way to change or forget', async () => {
    renderScreen(false);

    expect(await screen.findByLabelText('Remember for')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Show possible matches/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotate the key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forget all visitors' })).not.toBeInTheDocument();
  });

  // --- Operator-signed identity (ID-03 · K28 · tm 388) -----------------------

  it('says signed identity is off by default, and that switching it on without a secret checks nothing', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(await screen.findByText(/Off: signed identities are ignored/)).toBeVisible();
    expect(screen.getByText(/No secret yet\./)).toBeVisible();
    // A workspace security switch: a draft until Save (GV-06), not an instant write.
    await user.click(screen.getByRole('checkbox', { name: /Accept signed identities/ }));
    expect(patches).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    // The switch alone — not mistaken for a lifetime or match change.
    expect(patches[0]).toStrictEqual({ signed_identity_enabled: true });
    expect(await screen.findByText(/On, but no secret has been issued yet/)).toBeVisible();
  });

  it('shows the issued secret exactly once, in a dialog that warns it never goes in a browser; closing discards it', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Issue a secret' }));
    await waitFor(() => expect(issues).toHaveLength(1));
    const dialog = await screen.findByRole('dialog', { name: 'Your identity secret' });
    expect(within(dialog).getByTestId('member-identity-secret')).toHaveTextContent(ISSUED_SECRET);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Never put it in a web page/);

    await user.click(within(dialog).getByRole('button', { name: 'I have stored it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Described from now on — the secret itself is nowhere on the screen.
    expect(document.body).not.toHaveTextContent(ISSUED_SECRET);
    expect(screen.getByRole('button', { name: 'Issue a new secret' })).toBeVisible();
  });

  it('asks before issuing a new secret, with the old one accepted for the grace window it sends in seconds', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...DEFAULTS,
      signed_identity: {
        enabled: true,
        active: true,
        secret: {
          version: 2,
          created_at: '2026-11-01T08:00:00.000Z',
          previous_version: null,
          previous_valid_until: null,
        },
        recent: { days: 7, verified: 0, refused: {} },
      },
    });
    renderScreen();

    expect(await screen.findByText(/On: signed identities are checked/)).toBeVisible();
    const grace = screen.getByLabelText('Keep the old secret for (days)');
    expect(grace).toHaveValue(1);
    await user.clear(grace);
    await user.type(grace, '3');
    await user.click(screen.getByRole('button', { name: 'Issue a new secret' }));
    const confirm = screen.getByRole('dialog', { name: 'Issue a new identity secret?' });
    expect(confirm).toHaveTextContent('still accepted for 3 days');
    expect(issues).toHaveLength(0);

    await user.click(within(confirm).getByRole('button', { name: 'Issue secret' }));
    await waitFor(() => expect(issues).toHaveLength(1));
    expect(issues[0]).toStrictEqual({ grace_period_seconds: 3 * DAY });
    expect(await screen.findByRole('dialog', { name: 'Your identity secret' })).toBeVisible();
  });

  it('names the emergency rotation of the secret when the grace window is 0, and holds it to 0–30 days', async () => {
    const user = userEvent.setup();
    stubFetch({
      ...DEFAULTS,
      signed_identity: {
        enabled: true,
        active: true,
        secret: {
          version: 1,
          created_at: '2026-11-01T08:00:00.000Z',
          previous_version: null,
          previous_valid_until: null,
        },
        recent: null,
      },
    });
    renderScreen();

    const grace = await screen.findByLabelText('Keep the old secret for (days)');
    await user.clear(grace);
    await user.type(grace, '31');
    expect(screen.getByRole('button', { name: 'Issue a new secret' })).toBeDisabled();
    await user.clear(grace);
    await user.type(grace, '0');
    expect(screen.getByText(/0 retires the old secret at once/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Issue a new secret' }));
    expect(screen.getByRole('dialog', { name: 'Issue a new identity secret?' })).toHaveTextContent(
      /stops working at once/,
    );
    // The counters could not be read: said so, not drawn as zeros.
    expect(screen.getByText(/could not be read/)).toBeVisible();
  });

  it('counts the last week’s signatures, verified and ignored by reason', async () => {
    stubFetch({
      ...DEFAULTS,
      signed_identity: {
        enabled: true,
        active: true,
        secret: {
          version: 1,
          created_at: '2026-11-01T08:00:00.000Z',
          previous_version: null,
          previous_valid_until: null,
        },
        recent: { days: 7, verified: 12, refused: { bad_signature: 3, expired: 1 } },
      },
    });
    renderScreen();

    expect(await screen.findByTestId('signed-identity-verified')).toHaveTextContent('12 verified');
    expect(screen.getByText(/Ignored: wrong signature/)).toHaveTextContent('3');
    expect(screen.getByText(/Ignored: older than five minutes/)).toHaveTextContent('1');
    expect(screen.queryByText(/Ignored: already used once/)).not.toBeInTheDocument();
  });

  it('gives the developer the message to sign and server examples, never a browser one', async () => {
    renderScreen();
    expect(await screen.findByText('For your developer')).toBeInTheDocument();
    const notes = screen.getByText('For your developer').closest('details')!;
    expect(notes).toHaveTextContent(
      'siyahtus-identify-v1\\n<user_id>\\n<username>\\n<email>\\n<ts>',
    );
    expect(notes).toHaveTextContent("createHmac('sha256', process.env.SIYAHTUS_IDENTITY_SECRET)");
    expect(notes).toHaveTextContent(
      "hash_hmac('sha256', $message, getenv('SIYAHTUS_IDENTITY_SECRET'))",
    );
    // The contract's user_id is a string: a numeric id sent as a number is
    // refused as malformed, so both examples sign and send the id as text.
    expect(notes).toHaveTextContent('const id = String(user.id);');
    expect(notes).toHaveTextContent('return { user_id: id,');
    expect(notes).toHaveTextContent("$id = (string) $user['id'];");
    expect(notes).toHaveTextContent("return ['user_id' => $id,");
    expect(notes).not.toHaveTextContent('user_id: user.id');
    expect(notes).toHaveTextContent('siyahtus("logout")');
  });

  it('is read-only for signed identity without write access: the status, a locked switch, no secret button', async () => {
    renderScreen(false);
    expect(await screen.findByText(/Off: signed identities are ignored/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Accept signed identities/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Issue a secret' })).not.toBeInTheDocument();
  });

  it('renders in Turkish', async () => {
    renderWithLocale(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemberRecognition canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByLabelText('Hatırlama süresi')).toHaveValue(30);
    expect(screen.getByRole('button', { name: 'Anahtarı yenile' })).toBeVisible();
  });
});
