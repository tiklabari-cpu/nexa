-- The files a customer erasure still owes the object store (tm 423 · NFR-C8).
--
-- A new table only: nothing existing is read differently, so old and new code
-- both run against it (CONVENTIONS §6.3).
--
-- The erasure writes one row per file in the same transaction that deletes the
-- rows referring to it, deletes the files after the commit, and the row with
-- each. A file the store would not delete keeps its row; the retention sweep
-- deletes it on its next pass. Without the row, a failed delete would leave a
-- file nothing points at any more — the sweeps find files through the rows
-- that refer to them — and nobody would ever delete it.

-- CreateTable
CREATE TABLE "pending_file_deletions" (
    "license_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_file_deletions_pkey" PRIMARY KEY ("license_id", "key")
);

-- AddForeignKey
ALTER TABLE "pending_file_deletions" ADD CONSTRAINT "pending_file_deletions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only an upload (`<licence>-<uuid><ext>`) or an e-mailed file
-- (`<licence>-m-<uuid><ext>`) — the shapes `upload-url.ts` builds — and only
-- one whose licence prefix is the row's own. A knowledge document (`-k-`) or an
-- invoice (`-i-`) is not a customer's file, and another workspace's key cannot
-- be queued here even by a mistake in the code that collects them.
ALTER TABLE "pending_file_deletions" ADD CONSTRAINT "pending_file_deletions_key_check" CHECK (
  "key" ~ '^[0-9]{1,19}-(m-)?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(\.[a-z0-9]{1,8})?$'
  AND split_part("key", '-', 1) = "license_id"::text
);

-- License-scoped like every other tenant table.
ALTER TABLE pending_file_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_file_deletions_tenant ON pending_file_deletions
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands siyahtus_app SELECT, INSERT, UPDATE, DELETE on every table created
-- after it; the erasure inserts and deletes, the sweep reads and deletes.
