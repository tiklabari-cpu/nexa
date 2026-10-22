/**
 * The reason a high-risk setting change carries (GV-06-S1 · tm 323.2).
 *
 * Some settings decide who may see or do what across the whole workspace — the
 * AI compliance rules (AI-08), how long data is kept (NFR-C8), and the
 * permission matrix once it lands (RL-02). The panel saves those only after the
 * person has seen the before/after and said why; the reason travels in the
 * request body as `reason` and the API files it with the change's audit entry.
 *
 * One bound for both sides, so the box in `ConfirmHighRisk` can never accept a
 * reason the endpoint then refuses.
 */
export const HIGH_RISK_REASON_MAX = 500;
