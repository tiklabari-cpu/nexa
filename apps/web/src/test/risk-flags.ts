/** A risk flag as the API returns it, for the risk screens' tests (tm 302.3). */
import type { RiskFlagItem } from '../features/risk/riskFlags.js';

export function flag(overrides: Partial<RiskFlagItem> = {}): RiskFlagItem {
  return {
    id: 'f-1',
    scope: 'chat',
    chat_id: 'CHAT1',
    thread_id: 'TH1',
    customer_id: 'cust-1',
    member_key: null,
    type: 'complaint_formal',
    severity: 'high',
    source: 'agent',
    rule_ref: null,
    basis: 'declared',
    status: 'active',
    raised_by: 'agent-1',
    raised_at: '2026-10-19T10:00:00.000Z',
    cleared_by: null,
    cleared_at: null,
    note: null,
    evidence_event_ids: null,
    clear_reason: null,
    details_visible: false,
    ...overrides,
  };
}
