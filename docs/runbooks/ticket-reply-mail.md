# Runbook: ticket replies by e-mail (HD-01 · K23)

An agent's reply on a ticket is e-mailed to the player (tm 356.3). An internal
note never is — not with the switch on, not by a resend; the database refuses
to give a note a delivery status (`ticket_messages_note_not_mailed_check`).

Code: `apps/api/src/services/tickets/ticket-message-service.ts` (what is
stored and threaded), `apps/api/src/routes/tickets.ts` (`mailReply` — the send
after the commit). Setting: `TICKET_MAIL_OUTBOUND` (`true` / `false`, default
`false`). The root panel shows it in the effective configuration (tm 389.13);
it does not change it — this is a deployment decision.

## What the switch does

| `TICKET_MAIL_OUTBOUND` | A reply is stored | `delivery_status`                 | Mail                                    |
| ---------------------- | ----------------- | --------------------------------- | --------------------------------------- |
| `false` (default)      | yes               | `suppressed` — "not sent (pilot)" | none                                    |
| `true`                 | yes               | `queued` → `sent`, or `failed`    | kind `ticket_reply`, external daily cap |

With the switch off nothing else changes: the ticket still moves to `pending`,
the first response is still stamped. Turning it on later does **not** send the
replies written while it was off — they stay `suppressed`.

The mail: `From:` the system address (`SMTP_FROM`) under the workspace's name,
`[#<ticket id>] <subject>` as the subject, the reply's text only (masked; the
conversation before it is not quoted), `In-Reply-To` / `References` from the
ticket's earlier mail. Its `Message-ID` is stored on the reply before it is sent
— the player's answer will name it (HD-03, tm 358). Attachments stay in the
panel; they are not carried by the mail. While `PILOT_MODE=true` the text ends
with the "this mailbox does not read replies" line, as the ticket notice does.

A failed send is `failed`; the panel offers "try again"
(`POST /tickets/{id}/messages/{messageId}/resend`), which sends the same message
— same `Message-ID` — once, however often it is pressed. A send the carrier took
but never confirmed counts as `sent`, so it is not mailed twice.

## Before turning it on (no DNS change is made from this repository)

The player's mail server judges these messages by the `SMTP_FROM` domain. Before
`TICKET_MAIL_OUTBOUND=true` on a real deployment, the owner checks — in the DNS
provider's and mail provider's panels — what `docs/production-checklist.md`
§ "Mail authentication (SPF, DKIM, DMARC)" lists:

- one SPF record at the `SMTP_FROM` domain that includes the mail provider;
- DKIM switched on at the provider and its selector record published;
- a DMARC record at `_dmarc.<domain>` (start with `p=none` and a report address
  someone reads);
- a test reply to an outside mailbox shows `SPF`, `DKIM` and `DMARC` all
  `PASS` ("show original") and lands in the inbox.

Then set `TICKET_MAIL_OUTBOUND=true`, restart the API, and reply once on a test
ticket: the thread shows "sent".

## When replies show "could not send"

1. The API log has `"event":"ticket.reply_mail"` with the carrier's
   classification (`mail.code`, `mail.smtpCode`) and the `ticket_id` /
   `message_id` — never the address or the text.
2. No such line, but `"event":"mail.cap_reached"` with `kind: ticket_reply`: the
   workspace hit its external daily cap (`MAIL_DAILY_EXTERNAL_PER_WORKSPACE`);
   "try again" works once the day turns.
3. Anything else is the carrier: see `docs/adr/smtp-transport.md`.
4. A reply stuck at `queued` means the API stopped between the commit and the
   send (a crash; a graceful stop waits for the send). It is not retried by
   itself; there is no resend for `queued`.
