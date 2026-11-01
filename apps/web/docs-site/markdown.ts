/**
 * A small, safe Markdown renderer for the documentation page (KN-04 · tm 376).
 *
 * The document's prose is Markdown — headings, paragraphs, lists, tables, fenced
 * code, `code`, **bold**, links. It is built with `createElement` and
 * `textContent` only, never `innerHTML`, so a description containing `<script>` is
 * text and the page can keep a Content-Security-Policy with no inline script. A link
 * is followed only when it is `http(s)` or an in-page `#` anchor.
 */

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SAFE_HREF = /^(https?:\/\/|#)/i;

/** `code`, **bold**, *italic* and [text](url) inside one line of prose. */
export function renderInline(doc: Document, text: string, into: Node): void {
  const pattern =
    /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\w])\*([^*\s][^*]*)\*(?!\w)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) into.appendChild(doc.createTextNode(text.slice(last, at)));
    if (match[1] !== undefined) {
      into.appendChild(el(doc, 'code', undefined, match[1]));
    } else if (match[2] !== undefined) {
      into.appendChild(el(doc, 'strong', undefined, match[2]));
    } else if (match[3] !== undefined && match[4] !== undefined) {
      if (SAFE_HREF.test(match[4])) {
        const link = el(doc, 'a', undefined, match[3]);
        link.setAttribute('href', match[4]);
        if (!match[4].startsWith('#')) link.setAttribute('rel', 'noopener noreferrer');
        into.appendChild(link);
      } else {
        into.appendChild(doc.createTextNode(match[3]));
      }
    } else if (match[5] !== undefined) {
      into.appendChild(el(doc, 'em', undefined, match[5]));
    }
    last = at + match[0].length;
  }
  if (last < text.length) into.appendChild(doc.createTextNode(text.slice(last)));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

const isTableDivider = (line: string): boolean =>
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

/** Render Markdown `source` into a fragment of `doc`. Headings are shifted down by `shift` levels. */
export function renderMarkdown(doc: Document, source: string, shift = 0): DocumentFragment {
  const out = doc.createDocumentFragment();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = /^(\s*)```(\w*)\s*$/.exec(line);
    if (fence) {
      const indent = fence[1]!.length;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) {
        body.push(
          lines[i]!.slice(Math.min(indent, lines[i]!.length - lines[i]!.trimStart().length)),
        );
        i++;
      }
      i++; // closing fence
      const pre = el(doc, 'pre', 'code-block');
      const code = el(doc, 'code', undefined, body.join('\n'));
      if (fence[2]) {
        code.dataset['lang'] = fence[2];
        pre.dataset['lang'] = fence[2];
      }
      pre.appendChild(code);
      out.appendChild(pre);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.max(1, Math.min(6, heading[1]!.length + shift));
      const node = doc.createElement(`h${level}` as 'h1');
      renderInline(doc, heading[2]!, node);
      out.appendChild(node);
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]!)) {
      const head = splitRow(line);
      i += 2;
      const table = el(doc, 'table', 'md-table');
      const thead = el(doc, 'thead');
      const headRow = el(doc, 'tr');
      for (const cell of head) {
        const th = el(doc, 'th');
        renderInline(doc, cell, th);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el(doc, 'tbody');
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        const row = el(doc, 'tr');
        for (const cell of splitRow(lines[i]!)) {
          const td = el(doc, 'td');
          renderInline(doc, cell, td);
          row.appendChild(td);
        }
        tbody.appendChild(row);
        i++;
      }
      table.appendChild(tbody);
      const wrap = el(doc, 'div', 'table-wrap');
      wrap.appendChild(table);
      out.appendChild(wrap);
      continue;
    }

    const bullet = /^\s*([-*]|\d+\.)\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]!);
      const list = doc.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        const item = el(doc, 'li');
        let text = lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, '');
        i++;
        // A wrapped continuation line belongs to the item.
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]!) &&
          !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!)
        ) {
          text += ` ${lines[i]!.trim()}`;
          i++;
        }
        renderInline(doc, text, item);
        list.appendChild(item);
      }
      out.appendChild(list);
      continue;
    }

    // A paragraph runs to the next blank line or block start.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^\s*```/.test(lines[i]!) &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]!) &&
      !(lines[i]!.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]!))
    ) {
      paragraph.push(lines[i]!.trim());
      i++;
    }
    const p = el(doc, 'p');
    renderInline(doc, paragraph.join(' '), p);
    out.appendChild(p);
  }

  return out;
}
