import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useApiClient } from '../../lib/auth-store.js';

/**
 * An attachment on a message.
 *
 * The bytes sit behind a bearer token (`/uploads/:key`), so they are fetched
 * with the session's credentials and rendered from an object URL — an `<img>`
 * pointed straight at the path could not send the header and would 404. Images
 * preview inline; anything else is a download link, since we cannot safely
 * render an arbitrary type in our own origin.
 */
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

export function AttachmentView({ url, filename }: { url: string; filename?: string }): ReactElement {
  // `useApiClient` returns a fresh client every render, so it must not be an
  // effect dependency — the effect would re-run each render, revoke the object
  // URL it just made, and leave the `<img>` pointing at a freed blob. A ref
  // keeps the latest client while the effect depends only on the file.
  const api = useApiClient();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isImage = IMAGE.test(url);
  // `url` is `/api/v1/uploads/:key`; the client's base already carries `/api/v1`.
  const path = url.replace(/^\/api\/v1/, '');
  const name = filename ?? url.split('/').pop() ?? 'attachment';

  useEffect(() => {
    let revoked = false;
    let created: string | null = null;
    apiRef.current
      .getBlob(path)
      .then((blob) => {
        if (revoked) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (!revoked) setFailed(true);
      });
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);

  if (failed) {
    return <span className="text-2xs text-content-tertiary">Attachment unavailable</span>;
  }

  if (isImage) {
    return objectUrl ? (
      <a href={objectUrl} target="_blank" rel="noopener noreferrer">
        <img
          src={objectUrl}
          alt={name}
          data-testid="attachment-image"
          className="max-h-64 max-w-full rounded-md border border-border"
        />
      </a>
    ) : (
      <div className="h-32 w-48 animate-pulse rounded-md bg-inset" aria-label="Loading attachment" />
    );
  }

  return objectUrl ? (
    <a
      href={objectUrl}
      download={name}
      data-testid="attachment-file"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-inset px-2 py-1.5 text-2xs text-content-secondary hover:bg-surface-2"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      {name}
    </a>
  ) : (
    <span className="text-2xs text-content-tertiary">Loading…</span>
  );
}
