/**
 * What a `file` knowledge source may actually be — FR-MOD-06.3.2's "File".
 *
 * The knowledge base has four source kinds and, until this module existed, only
 * one of them was a lie: `type: "file"` meant "paste some text and call it a
 * file". A real upload needs three numbers and one list agreed on by both ends
 * — the allow-list of types, the byte ceiling, the character ceiling — so they
 * live here rather than once in the route and again in the form.
 *
 * **The allow-list is a MIME allow-list, not an extension allow-list.** The
 * server chooses its parser from `content_type` and never looks at the
 * filename, because a filename is attacker-supplied text with path semantics
 * and the endpoint has no business giving it a say in anything. The extension
 * map below is therefore a *client-side* convenience: browsers leave
 * `File.type` empty for `.md` on most platforms, so the form guesses a type
 * from the name it was given. A wrong guess costs nothing — the server refuses
 * it against the same list, and the bytes are checked regardless of what
 * anybody claimed about them.
 */

/**
 * The types a knowledge file may be uploaded as.
 *
 * Text formats only, and deliberately few. Everything on this list can be
 * turned into indexable text by a pure function with no dependency, no
 * subprocess and no network — which is the property that makes an upload path
 * safe to run inside a request. PDF and the Office formats are absent for that
 * reason and not by oversight: each one is a parser with a CVE history,
 * reachable by an admin-supplied byte string.
 */
export const KNOWLEDGE_FILE_MIME_TYPES = ['text/plain', 'text/markdown', 'text/csv'] as const;

export type KnowledgeFileMimeType = (typeof KNOWLEDGE_FILE_MIME_TYPES)[number];

/**
 * The most bytes one upload may carry, measured *after* base64 decoding.
 *
 * Two megabytes of UTF-8 text is a book-length manual, far past what an admin
 * assembles as one knowledge source, and small enough that decoding, decoding
 * again as text and chunking it all happen inside one request without the
 * process holding anything an attacker chose the size of. The transport
 * ceiling on the route sits above this so an oversized file is refused by the
 * typed error that names the limit rather than by an opaque body-too-large.
 */
export const KNOWLEDGE_FILE_MAX_BYTES = 2_097_152; // 2 MiB

/**
 * The most characters a parsed file may yield.
 *
 * The same ceiling `createSourceBody` puts on pasted `content`, so an upload
 * cannot smuggle in text the paste path would have refused. Bytes and
 * characters are both capped because they bound different things: bytes bound
 * what is buffered, characters bound what is chunked and embedded.
 */
export const KNOWLEDGE_FILE_MAX_CHARS = 100_000;

/**
 * Filename extension → MIME type, for a client that has to guess.
 *
 * Never consulted by the server. See the module note: this exists because
 * `File.type` is empty for Markdown in most browsers, and an admin who picks a
 * `.md` file should not be told their file has no type.
 */
export const KNOWLEDGE_FILE_EXTENSIONS: Readonly<Record<string, KnowledgeFileMimeType>> = {
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
};

/**
 * Strips a `; charset=…` parameter, trims and lower-cases a declared media
 * type, returning it only when it is one of {@link KNOWLEDGE_FILE_MIME_TYPES}.
 * `null` for anything else — including an empty string, which is what a browser
 * reports when it cannot tell.
 */
export function normalizeKnowledgeFileMime(
  value: string | null | undefined,
): KnowledgeFileMimeType | null {
  if (typeof value !== 'string') return null;
  const base = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return (KNOWLEDGE_FILE_MIME_TYPES as readonly string[]).includes(base)
    ? (base as KnowledgeFileMimeType)
    : null;
}

/** The lower-cased extension of `filename`, including the dot, or `''` when it has none. */
export function knowledgeFileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/**
 * A client's best guess at what it is about to upload: the type the browser
 * declared when that is one we accept, otherwise the one the extension implies,
 * otherwise `null` — which the form shows as "this kind of file is not
 * supported" without asking the server.
 *
 * The order matters. A declared type is evidence about the bytes; an extension
 * is evidence about the name. Preferring the declaration means a `.txt` a
 * browser knows to be CSV is parsed as CSV.
 */
export function knowledgeFileMimeFor(
  filename: string,
  declared?: string | null,
): KnowledgeFileMimeType | null {
  return (
    normalizeKnowledgeFileMime(declared) ??
    KNOWLEDGE_FILE_EXTENSIONS[knowledgeFileExtension(filename)] ??
    null
  );
}
