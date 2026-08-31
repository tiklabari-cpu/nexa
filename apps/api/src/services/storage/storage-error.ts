/**
 * "The store could not answer" — the one thing an `ObjectStore` is never
 * allowed to spell as absence.
 *
 * `LocalStore` answered every failure the same way: `stat` threw, so `exists`
 * returned `false`; `readFile` threw, so `get` returned `null`. On a local disk
 * that is nearly always right — the only realistic error is ENOENT, which *is*
 * absence. Over a network it stops being right at all. A refused connection, an
 * expired credential, a 500 from the bucket and a genuinely missing object all
 * arrive as "no", and collapsing them into `false` makes the store answer a
 * question it does not know the answer to.
 *
 * That matters because one of those answers is load-bearing. `attachment.ts`
 * reads `exists` to refuse an `attachment_url` pointing at a key that was
 * granted and never used — a security boundary. Answering `false` while the
 * bucket is unreachable does not open it (the boundary fails closed), but it
 * lies about *why*: the caller is told, with a 400, that their `attachment_url`
 * is not a file this workspace uploaded, when in fact it is and the storage
 * layer is down. A 400 is not retried, so the message is dropped for good, and
 * an outage that should page somebody is filed as a client mistake instead.
 *
 * So the rule both providers hold: **absence is only ever a definite absence**
 * (ENOENT on disk, `404` from the bucket). Everything else throws this.
 *
 * It extends `ApiError` — the same `service_unavailable` 503 `assertClean`
 * raises for an unreachable virus scanner, and for the same reason: "try again
 * shortly" is the truth, and it is what separates "your file is bad" from "we
 * could not look". Extending rather than converting at each seam is deliberate.
 * A plain error would put a `try/catch` obligation on every future reader of
 * the interface, and the forgotten one does not fail loudly — it falls into
 * whatever that caller already does with an unexpected error, which for the
 * three call sites here is a 500, and for anybody who writes the obvious
 * `catch { return null }` is exactly the silent absence this class exists to
 * prevent.
 *
 * The message the client sees is fixed and says nothing about the deployment.
 * The diagnostic — method, key, status, S3 error code — rides on `cause`, which
 * the error handler logs (`err`) and never sends.
 */
import { ApiError } from '../../lib/api-error.js';

export class StorageUnavailableError extends ApiError {
  /** What actually went wrong, for logs and tests. Never sent to a client. */
  readonly detail: string;

  constructor(detail: string, options: { cause?: unknown } = {}) {
    super(
      'service_unavailable',
      'File storage is unavailable right now. Please try again shortly.',
      { cause: options.cause ?? detail },
    );
    this.name = 'StorageUnavailableError';
    this.detail = detail;
  }
}
