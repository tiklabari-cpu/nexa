/**
 * Settings → "Send test email" (tm 464.3 · G-05): the button posts to
 * `/settings/email/test` with no body (the server picks the recipient — the
 * caller), and the answer is shown in words: sent, sent to a server that does
 * not really mail, retrying with the reason, or not sent with the reason and
 * the SMTP reply code. A 429 shows the rate-limit sentence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmtpTestMail, type SmtpTestResult } from './SmtpTestMail.js';
import { useAuth } from '../../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../../test/i18n.js';

let requests: Array<{ url: string; method: string; body: unknown }>;
let answer: () => Response;

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const result = (overrides: Partial<SmtpTestResult>): SmtpTestResult => ({
  status: 'sent',
  to: 'admin@acme.test',
  provider: 'smtp',
  error: null,
  ...overrides,
});

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  requests = [];
  answer = () => json(202, result({}));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
      return answer();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

function renderIt() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SmtpTestMail />
    </QueryClientProvider>,
  );
}

async function clickSend(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
}

describe('SmtpTestMail', () => {
  it('posts with no recipient and says where the test went', async () => {
    renderIt();
    await clickSend();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Test email sent to admin@acme.test.',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/settings\/email\/test$/);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.body ?? null).toBeNull();
  });

  it('does not call a spool-only server a delivery', async () => {
    answer = () => json(202, result({ provider: 'file' }));
    renderIt();
    await clickSend();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'this server is not set up to send real email',
    );
  });

  it('shows a retryable failure with its reason and SMTP code', async () => {
    answer = () =>
      json(
        202,
        result({
          status: 'queued',
          error: { code: 'rejected', phase: 'rcpt_to', smtp_code: 451 },
        }),
      );
    renderIt();
    await clickSend();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The first try failed: the mail server refused the message (SMTP 451). It will be retried automatically.',
    );
  });

  it('shows refused credentials as not sent', async () => {
    answer = () =>
      json(
        202,
        result({ status: 'failed', error: { code: 'auth', phase: 'auth', smtp_code: 535 } }),
      );
    renderIt();
    await clickSend();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Not sent: the mail server rejected the username or password (SMTP 535).',
    );
  });

  it('shows a reason without a code when the server had no reply', async () => {
    answer = () =>
      json(
        202,
        result({
          status: 'failed',
          error: { code: 'connection', phase: 'connect', smtp_code: null },
        }),
      );
    renderIt();
    await clickSend();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Not sent: could not connect to the mail server.',
    );
  });

  it('shows the rate limit as an error', async () => {
    answer = () =>
      json(429, {
        error: { type: 'too_many_requests', message: 'At most 5', request_id: 'req_1' },
      });
    renderIt();
    await clickSend();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('speaks Turkish', async () => {
    answer = () =>
      json(
        202,
        result({ status: 'failed', error: { code: 'auth', phase: 'auth', smtp_code: 535 } }),
      );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <SmtpTestMail />
      </QueryClientProvider>,
      'tr',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Test e-postası gönder' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Gönderilmedi: e-posta sunucusu kullanıcı adını veya şifreyi reddetti (SMTP 535).',
    );
  });
});
