/**
 * Where a sealed SIEM page is actually delivered (M-PROV-a · §D113/K3) —
 * `SIEM_PROVIDER`.
 *
 * The file writing used to live inside `siem-sink.ts`, which meant the sink knew
 * both *when* to deliver a workspace's trail and *how* — and the how is the only
 * part a deployment would ever replace (Splunk HEC, an S3 bucket, syslog). This
 * module is the how; the sink keeps the when, the locking and the cursor.
 *
 * **The half of the order invariant that lives here.** `siem-sink.ts` documents
 * why the file must be written and closed *before* the cursor moves: reverse
 * them and a crash in between makes undelivered records look delivered, and the
 * retention rule then prunes rows nobody ever received. `deliver` therefore only
 * resolves once the bytes are durably written — `writeFile` resolves after the
 * descriptor is flushed and closed — and it *throws* rather than resolving on a
 * partial write, because the sink's transaction rolls back on a throw and
 * advances the cursor on a resolve. Any future implementation inherits that
 * contract: resolve means "the destination has it", not "the request left".
 *
 * **Two vocabularies, deliberately overlapping.** `SIEM_EXPORT_TARGETS` is what
 * a *workspace* picks and is stored per row; `SIEM_PROVIDER` is what this
 * *deployment* can actually deliver to. They are the same words because a
 * workspace may only pick something the deployment implements — and when the
 * database holds a target this build has no code for, `SiemSink` fails loudly
 * rather than quietly shipping nothing (see the switch it replaced).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One sealed page, ready to hand over. */
export interface SiemBatch {
  /** Whose trail this is — also the partition the file sink writes under. */
  licenseId: bigint;
  /** The sweep's instant, so a test can run the same one twice. */
  now: Date;
  /** The NDJSON body, already signed. */
  body: string;
  /** The detached signature over `body` (`audit-export.ts`). */
  signature: string;
}

export interface SiemTarget {
  /** The `SIEM_EXPORT_TARGETS` value this implementation serves. */
  readonly name: string;
  /**
   * Deliver one page and return a locator for it — a path here, a URL or a
   * receipt id elsewhere. Resolves only once the destination durably has it;
   * throws otherwise.
   */
  deliver(batch: SiemBatch): Promise<string>;
}

/**
 * The mock file sink: `.data/siem/<licenseId>/<timestamp>-<random>.ndjson`,
 * plus a `.sig` sidecar carrying the detached signature — the same split
 * `audit-export.ts` documents for the pull endpoint's header, here as a second
 * file because a file sink has no header to put it in.
 *
 * A random suffix, like `FileMailer`'s, keeps two deliveries in the same
 * millisecond (concurrent sweeps, or a fast retry) from colliding.
 */
export class FileSiemTarget implements SiemTarget {
  readonly name = 'file';
  readonly #siemDir: string;

  constructor(siemDir: string) {
    this.#siemDir = siemDir;
  }

  async deliver(batch: SiemBatch): Promise<string> {
    const dir = join(this.#siemDir, batch.licenseId.toString());
    await mkdir(dir, { recursive: true });
    const stamp = batch.now.toISOString().replace(/[:.]/g, '-');
    const path = join(dir, `${stamp}-${randomUUID().slice(0, 8)}.ndjson`);
    await writeFile(path, batch.body, 'utf8');
    await writeFile(`${path}.sig`, batch.signature, 'utf8');
    return path;
  }
}

/** The SIEM destinations this deployment can select between (`SIEM_PROVIDER`). */
export const SIEM_PROVIDERS = ['file'] as const;
export type SiemProvider = (typeof SIEM_PROVIDERS)[number];

export interface SiemTargetOptions {
  /** Root the `file` provider writes under (`env.SIEM_DIR`). */
  siemDir: string;
}

/** The destination `SIEM_PROVIDER` names. */
export function createSiemTarget(provider: SiemProvider, options: SiemTargetOptions): SiemTarget {
  switch (provider) {
    case 'file':
      return new FileSiemTarget(options.siemDir);
  }
}
