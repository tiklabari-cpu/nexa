/**
 * Virus scanning for uploads (FR-MOD-08.9.4).
 *
 * The PRD requires a scan but names no tool — that choice is ours (PLAN.md §C).
 * The shape is a provider, like storage and mail: a `mock` scanner for local and
 * test runs that flags the industry-standard EICAR test file and passes anything
 * else, and room for a real one (ClamAV over `clamd`) behind the same interface.
 *
 * The one rule that is not negotiable is **fail closed**. A file that cannot be
 * scanned — because the scanner is unreachable — is refused, never stored on
 * trust. `scan` therefore *rejects* on an unreachable scanner; it only resolves
 * with a verdict when it actually reached one.
 */
import { ApiError } from '../../lib/api-error.js';

/**
 * The EICAR anti-virus test string (not a real virus). Every scanner is required
 * to detect it, which is exactly what makes it usable as a fixture.
 */
export const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface VirusScanResult {
  clean: boolean;
  /** The matched signature name when `clean` is false. */
  signature?: string;
}

export interface VirusScanner {
  /** Resolves with the verdict; rejects when the scanner cannot be reached. */
  scan(bytes: Buffer): Promise<VirusScanResult>;
}

export class ScannerUnavailableError extends Error {
  constructor(message = 'The virus scanner is unreachable.') {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

/** Flags the EICAR test file, passes everything else. */
export class MockVirusScanner implements VirusScanner {
  async scan(bytes: Buffer): Promise<VirusScanResult> {
    if (bytes.includes(Buffer.from(EICAR_SIGNATURE, 'latin1'))) {
      return { clean: false, signature: 'EICAR-Test-File' };
    }
    return { clean: true };
  }
}

/** A scanner that is always down — models the fail-closed path for tests and drills. */
export class UnavailableVirusScanner implements VirusScanner {
  scan(): Promise<VirusScanResult> {
    return Promise.reject(new ScannerUnavailableError());
  }
}

export function createVirusScanner(provider: 'mock' | 'unavailable'): VirusScanner {
  return provider === 'unavailable' ? new UnavailableVirusScanner() : new MockVirusScanner();
}

/**
 * Scan `bytes` and refuse anything that is not provably clean.
 *
 * Two refusals, kept distinct so a client can tell "your file is bad" from "try
 * again later": an infected file is a `validation` 400, an unreachable scanner
 * is a `service_unavailable` 503. Both stop the bytes before they are stored.
 */
export async function assertClean(scanner: VirusScanner, bytes: Buffer): Promise<void> {
  let result: VirusScanResult;
  try {
    result = await scanner.scan(bytes);
  } catch {
    // Fail closed — a file we could not scan is refused, never trusted.
    throw new ApiError(
      'service_unavailable',
      'File scanning is unavailable right now. Please try again shortly.',
    );
  }
  if (!result.clean) {
    throw ApiError.validation('This file was rejected by the virus scan.');
  }
}
