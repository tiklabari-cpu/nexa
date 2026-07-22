import type { ReactElement, ReactNode } from 'react';

/**
 * Every empty state says what would fill it and, where there is one, offers the
 * next step. A bare empty rectangle reads as broken (design-brief §1.5).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-base font-medium">{title}</p>
      <p className="max-w-xs text-sm text-content-secondary">{description}</p>
      {action}
    </div>
  );
}
