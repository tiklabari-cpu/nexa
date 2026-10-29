/**
 * The print view of one connection's transcript (AR-04 · tm 338),
 * `/app/archive/:chatId/print?thread=&copy=` — outside the shell, so the
 * printed page is the transcript alone. The browser's "Save as PDF" keeps
 * every Turkish letter: the page is drawn in the system's own sans-serif,
 * not the reports' PDF writer, which cannot draw ğ, ş, ı or İ.
 *
 * It reads the server's printable file (`format=html`, audited as an export
 * like a download) once — not again on focus or remount: each read is a
 * new audit entry and counts against the minute's budget.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { parseTranscriptPage, transcriptFileUrl, type TranscriptPage } from './transcript.js';

const toolbarButton =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2';

export function TranscriptPrintPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const navigate = useNavigate();
  const { chatId = '' } = useParams();
  const [params] = useSearchParams();
  const threadId = params.get('thread') ?? '';
  const copy = params.get('copy') === 'internal' ? 'internal' : 'customer';

  const page = useQuery({
    queryKey: ['transcript-print', chatId, threadId, copy],
    queryFn: async (): Promise<TranscriptPage> => {
      const { blob } = await api.getFile(transcriptFileUrl(chatId, threadId, 'html', copy));
      const parsed = parseTranscriptPage(await blob.text());
      // i18n-ignore: developer-only — the error state shows its own catalogue title.
      if (parsed === null) throw new Error('not a transcript page');
      return parsed;
    },
    enabled: chatId !== '' && threadId !== '',
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="flex items-center gap-2 border-b border-border px-6 py-3 print:hidden">
        <button type="button" className={toolbarButton} onClick={() => navigate(-1)}>
          {t('archive.print.back')}
        </button>
        <button
          type="button"
          className="ml-auto rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          disabled={!page.data}
          onClick={() => window.print()}
        >
          {t('archive.print.print')}
        </button>
      </div>
      {page.isError || threadId === '' ? (
        <div className="p-6">
          <LoadError
            title={t('archive.print.error.title')}
            error={page.error}
            onRetry={() => void page.refetch()}
          />
        </div>
      ) : page.data ? (
        <TranscriptDocument page={page.data} />
      ) : (
        <p role="status" className="p-6 text-sm text-content-tertiary">
          {t('archive.print.loading')}
        </p>
      )}
    </div>
  );
}

function TranscriptDocument({ page }: { page: TranscriptPage }): ReactElement {
  return (
    <>
      <style>{page.style}</style>
      <main className="transcript" lang={page.lang}>
        <h1>{page.title}</h1>
        <dl>
          {page.rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {page.days.map((day, index) => (
          <section key={`${day.heading}-${index}`}>
            <h2>{day.heading}</h2>
            <ol>
              {day.lines.map((line, lineIndex) => (
                <li key={lineIndex} className={`line ${line.role}`}>
                  <span className="time">{line.time}</span>
                  <span className="who">{line.who}</span>
                  <p className="text">
                    {line.text.map((part, partIndex) => (
                      <span key={partIndex}>
                        {partIndex > 0 && <br />}
                        {part}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {page.empty !== null && <p className="empty">{page.empty}</p>}
        <p className="zone">{page.zone}</p>
      </main>
    </>
  );
}
