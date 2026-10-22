-- tm 325.6 (RL-02-S2): an AI hand-over's agents-only note no longer names the
-- player's pre-chat username or e-mail. The note is one event every viewer of
-- the chat reads, while `customers.contact.view` is a per-person answer; the
-- card itself (`ai_handoffs`, read through `GET /chats/{id}/ai-handoffs`)
-- keeps both and masks them per viewer.
--
-- Notes written before this change still quote the two values: blank them out
-- with the same mark the API uses (U+2022 ×3), from the values the card
-- recorded (`ai_handoffs.player`) — the text was built from exactly those. Data
-- only; old and new code read the column the same way (CONVENTIONS §6.3). A
-- value quoted in a different case elsewhere in an old note stays: the note's
-- own "Oyuncu" line, which every card has, matches exactly.
UPDATE events e
SET text = x.redacted
FROM (
  SELECT ev.id,
         ev.created_at,
         CASE WHEN nullif(btrim(h.player ->> 'username'), '') IS NULL THEN m.by_email
              ELSE replace(m.by_email, h.player ->> 'username', '•••')
         END AS redacted
  FROM events ev
  JOIN ai_handoffs h ON h.id::text = ev.properties ->> 'ai_handoff_id'
  CROSS JOIN LATERAL (
    SELECT CASE WHEN nullif(btrim(h.player ->> 'email'), '') IS NULL THEN ev.text
                ELSE replace(ev.text, h.player ->> 'email', '•••')
           END AS by_email
  ) m
  WHERE ev.properties ->> 'system_event' = 'ai_handoff_card'
    AND ev.text IS NOT NULL
) x
WHERE e.id = x.id
  AND e.created_at = x.created_at
  AND e.text IS DISTINCT FROM x.redacted;
