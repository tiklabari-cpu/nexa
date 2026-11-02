/**
 * The checks a tool step could not make (tm 321 · SiyahTuş analysis AI-28):
 * kept in `ai_conversations.signals.pending_checks` between turns, read by the
 * hand-over card ("Kontrol edilmesi gereken") and counted by the AI report.
 *
 * An entry names the tool, the step and the input mapping — slot names, never
 * values: the card reads the values from the slots when it is built, so a
 * value the player corrects later is the one a person checks.
 */
import { PENDING_CHECKS_SIGNAL, type PendingCheck } from '@siyahtus/types';
import type { AiStateObject } from '../state-store.js';

/** The pending checks kept in `signals`, malformed entries dropped (a tool key alone is an old card's). */
export function readPendingChecks(signals: AiStateObject): PendingCheck[] {
  const raw = signals[PENDING_CHECKS_SIGNAL];
  if (!Array.isArray(raw)) return [];
  const checks: PendingCheck[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      checks.push({ tool: entry, step_id: '', inputs: {} });
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { tool, step_id: stepId, inputs } = entry as Record<string, unknown>;
    if (typeof tool !== 'string') continue;
    const mapping: Record<string, string> = {};
    if (typeof inputs === 'object' && inputs !== null && !Array.isArray(inputs)) {
      for (const [name, slot] of Object.entries(inputs)) {
        if (typeof slot === 'string') mapping[name] = slot;
      }
    }
    checks.push({ tool, step_id: typeof stepId === 'string' ? stepId : '', inputs: mapping });
  }
  return checks;
}

/**
 * `signals` with this turn's checks added — once per tool and step, so a
 * procedure that passes the same step again keeps one line. Unchanged (the
 * same object) when there is nothing new.
 */
export function withPendingChecks(
  signals: AiStateObject,
  added: readonly PendingCheck[],
): AiStateObject {
  if (added.length === 0) return signals;
  const kept = readPendingChecks(signals);
  const next = [...kept];
  for (const check of added) {
    const index = next.findIndex((c) => c.tool === check.tool && c.step_id === check.step_id);
    if (index >= 0) next[index] = check;
    else next.push(check);
  }
  return { ...signals, [PENDING_CHECKS_SIGNAL]: next };
}
