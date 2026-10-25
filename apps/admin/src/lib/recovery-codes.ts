/**
 * The one-time recovery sheet, saved to a file.
 *
 * Shown exactly once after the authenticator is activated and neither screen can show it again,
 * so the download is one function rather than a copy per screen that could drift.
 */

/** `<a download>` over an object URL. */
export function downloadRecoveryCodes(codes: string[]): void {
  const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'siyahtus-platform-recovery-codes.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
