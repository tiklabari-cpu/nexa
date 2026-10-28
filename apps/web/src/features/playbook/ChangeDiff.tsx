/**
 * One change's difference, side by side (tm 315 · AI-21): a row per changed
 * leaf — the field (a procedure step reads "Adım 3 · target"), what it was,
 * what it became. The values are as the history kept them: masked (AI-26),
 * and a text over 20 KB as its length only.
 */
import type { ReactElement } from 'react';
import type { AiConfigDiffEntry } from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';
import { describeDiffEntry, diffValueText } from './ai-changes.js';

export function ChangeDiff({ diff }: { diff: readonly AiConfigDiffEntry[] }): ReactElement {
  const t = useTranslate();
  if (diff.length === 0) {
    return <p className="text-2xs text-content-tertiary">{t('playbook.history.diff.none')}</p>;
  }
  const text = (value: unknown) =>
    diffValueText(value, (length) => t('playbook.history.diff.omitted', { length }));
  const step = (n: number) => t('playbook.history.diff.step', { n });
  return (
    <table className="w-full table-fixed text-left text-xs" data-testid="change-diff">
      <caption className="sr-only">{t('playbook.history.diff.caption')}</caption>
      <thead className="text-2xs text-content-tertiary">
        <tr>
          <th scope="col" className="w-1/4 py-1 pr-2 font-medium">
            {t('playbook.history.diff.field')}
          </th>
          <th scope="col" className="py-1 pr-2 font-medium">
            {t('playbook.history.diff.before')}
          </th>
          <th scope="col" className="py-1 font-medium">
            {t('playbook.history.diff.after')}
          </th>
        </tr>
      </thead>
      <tbody>
        {diff.map((entry, index) => {
          const line = describeDiffEntry(entry, text, step);
          return (
            <tr key={`${entry.path}-${index}`} className="border-t border-border align-top">
              <th scope="row" className="break-words py-1.5 pr-2 font-mono text-2xs font-normal">
                {line.label}
              </th>
              <td className="whitespace-pre-wrap break-words py-1.5 pr-2 text-content-secondary">
                <del className="no-underline">{line.before}</del>
              </td>
              <td className="whitespace-pre-wrap break-words py-1.5 text-content">
                <ins className="no-underline">{line.after}</ins>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
