/**
 * A parsed document's blocks, packed into the chunks that are embedded (tm
 * 313.3 · SiyahTuş analysis AI-18).
 *
 * The worker (`worker.ts`) returns blocks in reading order, each with the pages
 * it sits on; this is the one place they become chunks:
 *
 * - **~600 characters** ({@link DOCUMENT_CHUNK_CHARS}, the size every other
 *   source is cut to — one retrieval threshold fits them all). Blocks are
 *   joined, one per line, until the next one would not fit; a block longer than
 *   that alone is cut by sentence (`chunk()`, one sentence of overlap).
 * - **Never across a heading.** A heading closes the chunk before it and opens
 *   the next, so a chunk is the text of one section — and a section's first
 *   chunk opens with its heading, which is what a question about "Madde 4"
 *   matches.
 * - **Pages follow the blocks taken.** `pageFrom` is the first block's, `pageTo`
 *   the last block's `pageTo`; a long block cut into pieces gives each piece the
 *   block's pages — the text does not say which of them a sentence is on.
 * - **`heading`** is the nearest heading block before the chunk (the chunk's own
 *   when it opens with one), clipped to {@link DOCUMENT_HEADING_CHARS}; null
 *   before the first heading.
 *
 * A heading with nothing under it before the next heading or the end is not a
 * chunk of its own — a title page's lone line says nothing a question asks —
 * unless the whole document is headings, which would leave it unreadable.
 */
import { chunk as splitBySentence } from '@siyahtus/ai-mock';
import type { DocumentBlock } from './types.js';

/** The size a chunk is packed to — the same as the other sources' (`@siyahtus/ai-mock` `chunk`). */
export const DOCUMENT_CHUNK_CHARS = 600;
/** `knowledge_chunks.heading` is a label, not a paragraph. */
export const DOCUMENT_HEADING_CHARS = 200;

export interface DocumentChunk {
  text: string;
  pageFrom: number;
  pageTo: number;
  heading: string | null;
}

interface Open {
  parts: string[];
  length: number;
  pageFrom: number;
  pageTo: number;
  heading: string | null;
  /** Whether anything but a heading went in. */
  body: boolean;
}

function clipHeading(text: string): string {
  return text.length > DOCUMENT_HEADING_CHARS
    ? `${text.slice(0, DOCUMENT_HEADING_CHARS - 1)}…`
    : text;
}

export function chunkDocument(
  blocks: readonly DocumentBlock[],
  maxChars: number = DOCUMENT_CHUNK_CHARS,
): DocumentChunk[] {
  const out: DocumentChunk[] = [];
  const headingOnly: DocumentChunk[] = [];
  let heading: string | null = null;
  let open: Open | null = null;

  const close = (): void => {
    if (open === null) return;
    const text = open.parts.join('\n');
    const made: DocumentChunk = {
      text,
      pageFrom: open.pageFrom,
      pageTo: open.pageTo,
      heading: open.heading,
    };
    if (open.body) out.push(made);
    else headingOnly.push(made);
    open = null;
  };

  const begin = (block: DocumentBlock): Open => ({
    parts: [],
    length: 0,
    pageFrom: block.pageFrom,
    pageTo: block.pageTo,
    heading,
    body: false,
  });

  const add = (target: Open, block: DocumentBlock, text: string): void => {
    target.length += (target.parts.length > 0 ? 1 : 0) + text.length;
    target.parts.push(text);
    target.pageTo = Math.max(target.pageTo, block.pageTo);
    if (block.kind !== 'heading') target.body = true;
  };

  for (const block of blocks) {
    const text = block.text.trim();
    if (text === '') continue;

    if (block.kind === 'heading') {
      close();
      heading = clipHeading(text);
      open = begin(block);
      add(open, block, text);
      continue;
    }

    if (text.length > maxChars) {
      // Alone in its chunks, behind the heading chunk it follows if that has room.
      const pieces = splitBySentence(text, maxChars);
      for (const piece of pieces) {
        if (open !== null && open.length + 1 + piece.length > maxChars) close();
        open ??= begin(block);
        add(open, block, piece);
        // A piece that fills a chunk ends it: the next sentence starts the next one.
        if (open.length >= maxChars * 0.8) close();
      }
      continue;
    }

    if (open !== null && open.length + 1 + text.length > maxChars) close();
    open ??= begin(block);
    add(open, block, text);
  }
  close();

  return out.length > 0 ? out : headingOnly;
}
