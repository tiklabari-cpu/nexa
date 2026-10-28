/**
 * What a PDF or Word source's row says beyond a text source's (tm 313.3 ·
 * AI-18): its page count, why it could not be read, and "Download original".
 *
 * The reason is the code the document job left in `last_refresh_error`
 * (`encrypted`, `no_text_layer`, …), which has a sentence of its own; any other
 * text there is a refresh failure, not this component's to word. The download
 * asks for a five-minute signed link and follows it — the browser takes the
 * file as an attachment, so the page stays where it is.
 */
import { useMutation } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  KNOWLEDGE_DOCUMENT_ERROR_KEYS,
  knowledgeDocumentErrorCode,
} from './knowledge-document-upload.js';
import type { KnowledgeSource } from './types.js';

/** What `GET /knowledge-sources/{id}/file` answers that the download needs. */
interface KnowledgeFileLink {
  url: string;
  filename: string;
}

/** Whether `source` is a PDF or Word document (the others keep no original). */
export function isDocumentSource(source: Pick<KnowledgeSource, 'file_mime'>): boolean {
  return typeof source.file_mime === 'string';
}

export function KnowledgeDocumentInfo({ source }: { source: KnowledgeSource }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const download = useMutation({
    mutationFn: () => api.get<KnowledgeFileLink>(`/knowledge-sources/${source.id}/file`),
    onSuccess: (link) => {
      // The link is same-origin and signed; an anchor with `download` hands the
      // file to the browser without navigating the console away.
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.download = link.filename;
      anchor.rel = 'noopener';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    },
  });

  const code = knowledgeDocumentErrorCode(source.last_refresh_error);
  const pages = source.page_count ?? 0;

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs">
      {pages > 0 && (
        <span className="text-content-tertiary">
          {t('playbook.knowledge.document.pageCount', { count: pages })}
        </span>
      )}
      {source.status === 'processing' && (
        <span role="status" className="text-content-tertiary">
          {t('playbook.knowledge.document.processing')}
        </span>
      )}
      {code && (
        <span role="alert" className="text-danger">
          {t(KNOWLEDGE_DOCUMENT_ERROR_KEYS[code])}
        </span>
      )}
      <button
        type="button"
        onClick={() => download.mutate()}
        disabled={download.isPending}
        aria-label={t('playbook.knowledge.document.downloadAria', { name: source.name })}
        className="text-content-secondary underline disabled:opacity-50"
      >
        {t('playbook.knowledge.document.download')}
      </button>
      {download.isError && (
        <span role="alert" className="text-danger">
          {t(errorMessageKey(download.error))}
        </span>
      )}
    </div>
  );
}
