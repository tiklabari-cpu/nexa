/**
 * Deterministic embeddings, no model required.
 *
 * The seed previously derived a vector from a chunk's *position*, which made
 * cosine similarity meaningless — a query about refunds was as close to the
 * delivery chunk as to the refund one, and retrieval only looked like it worked
 * because the demo had one source.
 *
 * This derives the vector from the text: a hashed bag of words projected into
 * 1536 dimensions and L2-normalised. It is not semantic — "delivery" and
 * "shipping" remain unrelated, as they would be to any lexical method — but it
 * has the two properties the rest of the system actually depends on:
 *
 *   1. same text → same vector, so tests and demos are reproducible;
 *   2. overlapping words → higher cosine similarity, so retrieval ranks by
 *      something real rather than by row order.
 *
 * Swapping in a real provider means replacing this one function. Nothing else
 * knows how the numbers were produced.
 */

export const EMBEDDING_DIMENSIONS = 1536;

/** Words carrying no signal; keeping them makes every document look alike. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'will',
  'with',
  'you',
  'your',
]);

/**
 * Text → comparable tokens.
 *
 * Diacritics are folded on purpose: a visitor typing "kargo nerede" should
 * reach an article written "kargó neredé", and someone searching "cafe" should
 * find "café". This only affects matching — the chunk text stored and shown to
 * an agent keeps its accents.
 *
 * The folding is explicit (`\p{M}` removed after NFKD) rather than a side
 * effect of the punctuation filter. It used to happen by accident, which meant
 * precomposed characters without a decomposition were treated differently from
 * ones with it, for no reason anybody had decided.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

/**
 * Crude suffix stripping.
 *
 * Without it "How long does delivery take?" misses an article saying "delivery
 * takes 3 to 5 days" — one character apart, and a lexical matcher treats them as
 * unrelated words. That is the single most common way this kind of retrieval
 * disappoints someone.
 *
 * Only English suffixes, and only when a reasonable stem is left. It is applied
 * to queries and documents alike, so both sides land on the same token; a word
 * it mangles is mangled identically everywhere and still matches itself.
 */
function stem(token: string): string {
  if (token.length < 5) return token;

  // "ies" → "y": deliveries and delivery should meet.
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;

  for (const suffix of ['ing', 'ed']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, -suffix.length);
    }
  }

  if (token.endsWith('es')) {
    // "es" only follows a sibilant — boxes, dishes, buzzes. Elsewhere the
    // plural is a bare "s" and stripping two characters mangles the word:
    // "takes" would become "tak", which meets nothing.
    const stem = token.slice(0, -2);
    const last = stem.at(-1) ?? '';
    if ('sxzh'.includes(last) && stem.length >= 3) return stem;
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) {
    return token.slice(0, -1);
  }

  return token;
}

/**
 * FNV-1a. Chosen for being stable across processes and platforms — `hashCode`
 * style implementations that rely on engine specifics would make an index built
 * on one machine unusable on another.
 */
function hash(token: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    value ^= token.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/**
 * Text → unit vector.
 *
 * Each token contributes to three buckets rather than one. A single bucket per
 * token makes collisions catastrophic: two unrelated words landing on the same
 * dimension become indistinguishable, and with 1536 dimensions that happens
 * often. Spreading the mass makes a collision a small amount of noise instead.
 */
export function embed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;

  // Sub-linear term frequency: a word repeated twenty times says a little more
  // than one said once, not twenty times more.
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  for (const [token, count] of counts) {
    const weight = 1 + Math.log(count);
    const base = hash(token);
    for (let probe = 0; probe < 3; probe++) {
      const bucket = (base + probe * 0x9e3779b1) >>> 0;
      const index = bucket % EMBEDDING_DIMENSIONS;
      // Sign from a spare bit, so unrelated tokens cancel rather than always
      // accumulating and pushing every vector towards the same direction.
      const sign = ((bucket >>> 31) & 1) === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign * weight;
    }
  }

  return normalise(vector);
}

function normalise(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

/** Cosine similarity. Inputs are already unit vectors, so this is a dot product. */
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new TypeError(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** pgvector literal — `[0.1,-0.2,…]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Split text for indexing.
 *
 * Paragraph-first, because a knowledge article's paragraphs are already its
 * units of meaning. Only oversized paragraphs are cut by sentence, and the cut
 * keeps one sentence of overlap so an answer spanning a boundary is not lost to
 * whichever half the query happened to match.
 */
export function chunk(text: string, maxChars = 600): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph];
    let current = '';
    let previousSentence = '';

    for (const sentence of sentences) {
      if (current.length + sentence.length > maxChars && current) {
        chunks.push(current.trim());
        current = previousSentence + sentence;
      } else {
        current += sentence;
      }
      previousSentence = sentence;
    }
    if (current.trim()) chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}
