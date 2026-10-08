const ACTION =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium text-content-secondary hover:bg-surface-2';

/** A header action's class: a labelled button, or a square icon when there is no room. */
export function actionClass(compact: boolean): string {
  return `${ACTION} ${compact ? 'h-7 w-7' : 'px-2.5 py-1'}`;
}
