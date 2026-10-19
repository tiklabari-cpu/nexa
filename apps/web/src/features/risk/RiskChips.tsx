/**
 * A conversation's risk flags as the transcript header shows them (AI-27 ·
 * tm 302.3): one chip per active flag, the most urgent first, so an agent
 * reading a conversation knows before they write that it is flagged and with
 * what. The header has no room for a sentence — what a flag does, who raised
 * it and what is written about it is the Details panel's Risk section; the
 * chip is the pointer to it.
 *
 * Everyone who sees the conversation sees the type and the severity (the
 * server hides only the note, the evidence and the clearing reason), so the
 * chips need no role check. Narrow, the chips collapse into one counted flag
 * that still names every type for a screen reader and a tooltip. Severity is
 * a glyph and a word in the tooltip, not colour alone.
 */
import type { ReactElement } from 'react';
import type { RiskFlagSeverity } from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';
import { useActiveRiskFlags } from './useRiskFlags.js';
import type { RiskFlagItem } from './riskFlags.js';

/** How many chips the full header draws before the rest fold into "+N". */
const VISIBLE_CHIPS = 2;

const TONE: Record<RiskFlagSeverity, string> = {
  urgent: 'border-danger/40 bg-danger/10',
  high: 'border-warning/40 bg-warning/10',
  info: 'border-border bg-inset',
};

const GLYPH_TONE: Record<RiskFlagSeverity, string> = {
  urgent: 'text-danger',
  high: 'text-warning',
  info: 'text-content-tertiary',
};

const GLYPH: Record<RiskFlagSeverity, string> = { urgent: '⚑', high: '⚑', info: '⚐' };

/** One flag: its type, with the severity as a glyph and in the tooltip. */
export function RiskChip({ flag }: { flag: RiskFlagItem }): ReactElement {
  const t = useTranslate();
  const type = t(`inbox.risk.type.${flag.type}`);
  const severity = t(`inbox.risk.severity.${flag.severity}`);
  return (
    <span
      data-risk-chip={flag.type}
      data-severity={flag.severity}
      title={`${type} — ${severity}`}
      className={`inline-flex max-w-[11rem] items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium ${TONE[flag.severity]}`}
    >
      <span aria-hidden="true" className={GLYPH_TONE[flag.severity]}>
        {GLYPH[flag.severity]}
      </span>
      <span className="truncate">{type}</span>
      <span className="sr-only">{severity}</span>
    </span>
  );
}

export function RiskChips({
  chatId,
  customerId,
  compact,
}: {
  chatId: string;
  customerId: string | null;
  compact: boolean;
}): ReactElement | null {
  const t = useTranslate();
  const { flags } = useActiveRiskFlags(chatId, customerId);
  if (flags.length === 0) return null;

  const names = flags.map((flag) => t(`inbox.risk.type.${flag.type}`));
  const worst = flags[0]!.severity;

  if (compact) {
    const label = t('inbox.risk.chips.compact', { types: names.join(', ') });
    return (
      <span
        data-risk-chips=""
        title={label}
        data-severity={worst}
        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium ${TONE[worst]}`}
      >
        <span aria-hidden="true" className={GLYPH_TONE[worst]}>
          {GLYPH[worst]}
        </span>
        <span aria-hidden="true">{flags.length}</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  const shown = flags.slice(0, VISIBLE_CHIPS);
  const hidden = flags.slice(VISIBLE_CHIPS);
  return (
    <ul
      data-risk-chips=""
      aria-label={t('inbox.risk.chips.label')}
      className="flex shrink-0 items-center gap-1"
    >
      {shown.map((flag) => (
        <li key={flag.id}>
          <RiskChip flag={flag} />
        </li>
      ))}
      {hidden.length > 0 && (
        <li>
          <span
            title={hidden.map((flag) => t(`inbox.risk.type.${flag.type}`)).join(', ')}
            className="rounded-sm border border-border bg-inset px-1.5 py-0.5 text-2xs font-medium"
          >
            {t('inbox.risk.chips.more', { count: hidden.length })}
          </span>
        </li>
      )}
    </ul>
  );
}
