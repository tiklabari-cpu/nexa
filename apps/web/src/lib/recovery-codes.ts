/**
 * The one-time recovery sheet, saved to a file.
 *
 * Shared by the two screens that can produce one: Account Settings, where a
 * signed-in person turns the factor on (S11-2FA-f), and the sign-in screen,
 * where somebody a workspace policy has locked out enrolls their way back in
 * (S11-2FA-k). Both show the codes exactly once and neither can show them
 * again — so the download has to behave identically in both, which is what
 * makes it worth one function rather than two copies that drift.
 */

/** `<a download>` over an object URL — the pattern `BulkImportForm.tsx` uses. */
export function downloadRecoveryCodes(codes: string[]): void {
  const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nexa-recovery-codes.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
