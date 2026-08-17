/**
 * Display formatting local to this feature — mirrors the wording
 * `apps/web/src/features/playbook` uses, not its code: a web module cannot be
 * imported across the workspace boundary into a Metro bundle.
 */
import type { SkillRun } from './types';

/** ISO timestamp → a short absolute date, or `null` for "no data" (never "0"). */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatRunCount(count: number): string {
  return `${count} ${count === 1 ? 'run' : 'runs'}`;
}

const RUN_STATUS_LABEL: Record<SkillRun['status'], string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  aborted: 'Aborted',
};

export function formatRunStatus(status: SkillRun['status']): string {
  return RUN_STATUS_LABEL[status];
}
