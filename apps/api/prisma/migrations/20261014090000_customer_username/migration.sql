-- Customer username (owner, 2026-10-14): the widget's pre-chat form now asks
-- for the visitor's username on the embedding site alongside name, e-mail and
-- the opening message, and it is kept on the contact so the agent sees it in
-- the customer panel.
--
-- Free text and unverified — the widget cannot prove it — so it is a hint for
-- the agent, never a lookup key: no index, no uniqueness. The 120-character
-- cap is enforced by the API (`customer.ts`), like `name`.
--
-- No RLS change: `customers` already carries its tenant policy, and a new
-- column inherits it.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "username" TEXT;
