-- PDF and Word knowledge sources, schema half (tm 313.1 · SiyahTuş analysis AI-18).
--
-- A document is uploaded to the object store (`POST /uploads` with
-- `purpose: knowledge_document`, under a `<licence>-k-<uuid>` key that
-- `GET /uploads/{key}` never serves), becomes a `file` source that is
-- `processing`, and is read by an isolated worker in a `document` knowledge
-- job (`knowledge_jobs_kind_check` already names the kind, 20261110090000).
--
--   1. `knowledge_sources` keeps the original (AI-18-S2): `file_key`,
--      `file_mime`, `file_size`, `file_sha256` — all four or none, a `file`
--      source's only, the key under the row's own licence. One source per
--      file per workspace: the same sha256 twice is a 409
--      `knowledge_source_exists`, and this unique index is what holds it
--      under a race. `page_count` (20261110090000) carries the document's
--      page count once read. The status vocabulary gains `processing`.
--   2. `knowledge_chunks` gains `page_from`/`page_to` (both or neither,
--      1-based, inclusive) and `heading` — what an answer cites.
--
-- Expand-only (CONVENTIONS §6.3): nullable columns, wider CHECKs, two unique
-- indexes over columns no row has a value in yet. A row an earlier release
-- writes satisfies every constraint below.

-- --------------------------------------------------------------------------
-- 1. knowledge_sources — the original file
-- --------------------------------------------------------------------------
ALTER TABLE "knowledge_sources" ADD COLUMN     "file_key" TEXT,
ADD COLUMN     "file_mime" TEXT,
ADD COLUMN     "file_sha256" CHAR(64),
ADD COLUMN     "file_size" INTEGER;

-- `processing` joins the six stored statuses (20261110090000): a document
-- whose `document` job has not finished reading it.
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_status_check;
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_status_check
  CHECK (status IN ('pending', 'indexing', 'ready', 'failed', 'crawling', 'partial', 'processing'));

-- All four or none, on a `file` source only. The key is one
-- `buildKnowledgeKey` makes, under this row's licence — a source can never
-- point at another workspace's object — and its extension is its type's.
-- `KNOWLEDGE_DOCUMENT_MIME_TYPES`, `KNOWLEDGE_DOCUMENT_LIMITS.maxBytes`.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_file_check CHECK (
  (file_key IS NULL AND file_mime IS NULL AND file_size IS NULL AND file_sha256 IS NULL)
  OR (
    type = 'file'
    AND file_key IS NOT NULL AND file_mime IS NOT NULL
    AND file_size IS NOT NULL AND file_sha256 IS NOT NULL
    AND file_key ~ ('^' || license_id::text
                    || '-k-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx)$')
    AND file_mime IN ('application/pdf',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    AND (file_mime = 'application/pdf') = (file_key LIKE '%.pdf')
    AND file_size BETWEEN 1 AND 20971520
    AND file_sha256 ~ '^[0-9a-f]{64}$'
  )
);

-- One object, one source: deleting a source deletes its object, which must
-- not be another source's too.
CREATE UNIQUE INDEX "knowledge_sources_file_key_key" ON "knowledge_sources"("file_key");

-- The same file once per workspace (NULLs are distinct: every source without
-- a file is outside it). Per workspace rather than per agent record: a
-- source's agent record follows its audiences (tm 309.2), and one source
-- already serves every audience and brand it names.
CREATE UNIQUE INDEX "knowledge_sources_license_id_file_sha256_key" ON "knowledge_sources"("license_id", "file_sha256");

-- --------------------------------------------------------------------------
-- 2. knowledge_chunks — page numbers and heading
-- --------------------------------------------------------------------------
ALTER TABLE "knowledge_chunks" ADD COLUMN     "heading" TEXT,
ADD COLUMN     "page_from" INTEGER,
ADD COLUMN     "page_to" INTEGER;

-- NOT VALID, then VALIDATE (the `threads_handled_by_check` pattern): the
-- columns are NULL on every existing chunk, so both checks hold, and VALIDATE
-- scans the largest knowledge table under SHARE UPDATE EXCLUSIVE.
ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_chunks_pages_check CHECK (
  (page_from IS NULL AND page_to IS NULL)
  OR (page_from IS NOT NULL AND page_to IS NOT NULL AND page_from >= 1 AND page_to >= page_from)
) NOT VALID;
ALTER TABLE knowledge_chunks VALIDATE CONSTRAINT knowledge_chunks_pages_check;

ALTER TABLE knowledge_chunks ADD CONSTRAINT knowledge_chunks_heading_check
  CHECK (heading IS NULL OR char_length(heading) BETWEEN 1 AND 500) NOT VALID;
ALTER TABLE knowledge_chunks VALIDATE CONSTRAINT knowledge_chunks_heading_check;
