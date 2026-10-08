/**
 * A refused upload reads in the console's language (O14, tm 259.18).
 *
 * `Composer.tsx` printed `error.message` as it came: the server's English
 * ("Files of type … are not allowed."), the client's own "Upload failed with
 * status 413." and — with the connection gone — the browser's "Failed to
 * fetch". Each case is driven through the real picker, in both languages.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { Composer } from './Composer.js';

interface Script {
  /** What `POST /uploads` answers: a refusal envelope, or the grant. */
  grant: { status: number; body: unknown } | 'network';
  /** What the signed `PUT` does: a status, or `network` to reject. */
  put?: number | 'network';
}

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function stubFetch(script: Script): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/uploads-policy')) return reply(200, { file_sharing_enabled: true });
      if (url.endsWith('/uploads') && init?.method === 'POST') {
        if (script.grant === 'network') throw new TypeError('Failed to fetch');
        return reply(script.grant.status, script.grant.body);
      }
      if (init?.method === 'PUT') {
        if (script.put === 'network') throw new TypeError('Failed to fetch');
        return reply(script.put ?? 200, {});
      }
      return reply(200, { items: [] });
    }),
  );
}

const refusal = (type: string, message: string, details?: Record<string, unknown>) => ({
  error: { type, message, request_id: 'req_up', ...(details ? { details } : {}) },
});

const GRANT_OK = {
  status: 201,
  body: { upload_url: '/api/v1/uploads/k?sig=1', file_url: '/api/v1/uploads/k' },
};

async function pickFile(script: Script, locale: 'en' | 'tr', file: File): Promise<void> {
  stubFetch(script);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
    locale,
  );
  const input = await waitFor(() => {
    const found = container.querySelector('input[type="file"]');
    if (!found) throw new Error('picker not mounted yet');
    return found as HTMLInputElement;
  });
  fireEvent.change(input, { target: { files: [file] } });
}

const PNG = new File(['x'], 'photo.png', { type: 'image/png' });
const EXE = new File(['x'], 'tool.exe', { type: 'application/x-msdownload' });

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('Composer upload failures', () => {
  it('names the refused type and what is allowed, in Turkish', async () => {
    await pickFile(
      {
        grant: {
          status: 422,
          body: refusal('validation', 'Files of type application/x-msdownload are not allowed.', {
            allowed_file_types: ['image/png', 'application/pdf'],
          }),
        },
      },
      'tr',
      EXE,
    );
    const alert = await screen.findByText(/türündeki dosyalara izin verilmiyor/);
    expect(alert).toHaveTextContent('application/x-msdownload');
    expect(alert).toHaveTextContent('image/png, application/pdf');
    expect(alert).not.toHaveTextContent(/are not allowed/);
  });

  it('says how large a file may be, from the server’s limit, in either language', async () => {
    await pickFile(
      {
        grant: {
          status: 422,
          body: refusal('validation', 'File is larger than this licence allows.', {
            max_file_size_bytes: 5 * 1024 * 1024,
          }),
        },
      },
      'tr',
      PNG,
    );
    expect(await screen.findByText(/izin verdiğinden büyük \(en fazla 5 MB\)/)).toBeInTheDocument();
    expect(screen.queryByText(/larger than this licence/)).not.toBeInTheDocument();
  });

  it('puts a refused byte upload in a sentence, never “Upload failed with status”', async () => {
    await pickFile({ grant: GRANT_OK, put: 500 }, 'tr', PNG);
    expect(await screen.findByText(/Yükleme başarısız oldu \(durum 500\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Upload failed with status/)).not.toBeInTheDocument();
  });

  it('is understandable when the connection drops during the upload (not “Failed to fetch”)', async () => {
    await pickFile({ grant: GRANT_OK, put: 'network' }, 'tr', PNG);
    expect(
      await screen.findByText('Sunucuya ulaşılamadı — bağlantınızı kontrol edin.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it('is understandable when the connection is gone before the permission step too', async () => {
    await pickFile({ grant: 'network' }, 'tr', PNG);
    expect(
      await screen.findByText('Sunucuya ulaşılamadı — bağlantınızı kontrol edin.'),
    ).toBeInTheDocument();
  });

  it('still reads in English in an English console', async () => {
    await pickFile({ grant: GRANT_OK, put: 500 }, 'en', PNG);
    expect(await screen.findByText('The upload failed (status 500). Try again.')).toBeVisible();
  });
});
