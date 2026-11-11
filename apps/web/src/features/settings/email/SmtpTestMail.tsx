/**
 * Settings → Ticket e-mails → "Send a test e-mail" (tm 464.3 · G-05).
 *
 * An administrator mails themselves to check that the server's mail settings
 * deliver. There is no address field: the server sends to the caller's own
 * address and nowhere else, so the screen only asks and shows the answer —
 * sent, retrying, unconfirmed or not sent, with the reason in words and the
 * SMTP reply code when there was one. Rendered for administrators only
 * (`SettingsPage.tsx`); the endpoint refuses everybody else anyway.
 */
import { useMutation } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, Section } from '../../../components/Page.js';
import { errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient } from '../../../lib/auth-store.js';
import { useTranslate } from '../../../lib/i18n.js';

const ERROR_CODES = [
  'timeout',
  'connection',
  'tls',
  'auth',
  'rejected',
  'protocol',
  'unconfirmed',
  'invalid_message',
  'cap_reached',
  'unexpected',
] as const;
type SmtpTestErrorCode = (typeof ERROR_CODES)[number];

export interface SmtpTestResult {
  status: 'sent' | 'queued' | 'unconfirmed' | 'failed';
  to: string;
  provider: 'file' | 'null' | 'smtp';
  error: { code: string; phase: string | null; smtp_code: number | null } | null;
}

function isKnownCode(code: string): code is SmtpTestErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

export function SmtpTestMail(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const send = useMutation({
    mutationFn: () => api.post<SmtpTestResult>('/settings/email/test'),
  });

  const reason = (error: NonNullable<SmtpTestResult['error']>): string => {
    const text = t(
      `settings.smtpTest.reason.${isKnownCode(error.code) ? error.code : 'unexpected'}`,
    );
    return error.smtp_code === null
      ? text
      : t('settings.smtpTest.withSmtpCode', { reason: text, code: error.smtp_code });
  };

  const result = send.data;
  let message: { tone: 'ok' | 'warn' | 'error'; text: string } | null = null;
  if (result) {
    if (result.status === 'sent') {
      message =
        result.provider === 'smtp'
          ? { tone: 'ok', text: t('settings.smtpTest.sent', { to: result.to }) }
          : { tone: 'warn', text: t('settings.smtpTest.notSmtp', { to: result.to }) };
    } else if (result.status === 'queued') {
      message = {
        tone: 'warn',
        text: result.error
          ? t('settings.smtpTest.queued', { reason: reason(result.error) })
          : t('settings.smtpTest.queuedNoReason'),
      };
    } else if (result.status === 'unconfirmed') {
      message = { tone: 'warn', text: t('settings.smtpTest.unconfirmed', { to: result.to }) };
    } else {
      message = {
        tone: 'error',
        text: t('settings.smtpTest.failed', {
          reason: result.error ? reason(result.error) : t('settings.smtpTest.reason.unexpected'),
        }),
      };
    }
  }

  const toneClass = {
    ok: 'text-success',
    warn: 'text-warning',
    error: 'text-danger',
  } as const;

  return (
    <Section title={t('settings.smtpTest.title')} description={t('settings.smtpTest.description')}>
      <Card>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate()}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {send.isPending ? t('settings.smtpTest.sending') : t('settings.smtpTest.button')}
            </button>
          </div>
          {message && (
            <p role="status" className={`text-sm ${toneClass[message.tone]}`}>
              {message.text}
            </p>
          )}
          {send.error && (
            <p role="alert" className="text-sm text-danger">
              {t(errorMessageKey(send.error))}
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}
