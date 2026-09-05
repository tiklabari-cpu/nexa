import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { applyBulletPrefix, renderRichText, wrapSelection } from './richText.js';

function Wrapper({ text }: { text: string }): ReactElement {
  return <span>{renderRichText(text)}</span>;
}

describe('wrapSelection (FR-MOD-02.3.5)', () => {
  it('wraps a selection in the marker and selects the wrapped text', () => {
    const result = wrapSelection('Hello world', { start: 6, end: 11 }, '**');
    expect(result.text).toBe('Hello **world**');
    expect(result.selectionStart).toBe(8);
    expect(result.selectionEnd).toBe(13);
  });

  it('drops an empty pair at the caret when nothing is selected', () => {
    const result = wrapSelection('Hello ', { start: 6, end: 6 }, '*');
    expect(result.text).toBe('Hello **');
    // Caret lands between the two markers, ready for the next keystroke.
    expect(result.selectionStart).toBe(7);
    expect(result.selectionEnd).toBe(7);
  });
});

describe('applyBulletPrefix (FR-MOD-02.3.5)', () => {
  it('prefixes the whole line the caret sits in', () => {
    const value = 'first\nsecond\nthird';
    const caret = value.indexOf('second') + 3; // mid-word, no selection
    const result = applyBulletPrefix(value, { start: caret, end: caret });
    expect(result.text).toBe('first\n- second\nthird');
  });

  it('does not double-prefix a line that already has one', () => {
    const result = applyBulletPrefix('- first', { start: 2, end: 2 });
    expect(result.text).toBe('- first');
  });

  it('prefixes every line a multi-line selection touches, not the one after it', () => {
    const value = 'a\nb\nc';
    // Covers "a\nb" — the selection ends right at the second line break.
    const result = applyBulletPrefix(value, { start: 0, end: value.indexOf('\n', 2) });
    expect(result.text).toBe('- a\n- b\nc');
  });
});

describe('renderRichText (FR-MOD-02.3.5)', () => {
  it('renders **bold** and *italic* as real elements', () => {
    render(<Wrapper text="**bold** and *italic*" />);
    expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('italic', { selector: 'em' })).toBeInTheDocument();
  });

  it('turns a `- ` line prefix into a bullet glyph', () => {
    render(<Wrapper text={'- first\n- second'} />);
    expect(screen.getByText(/• first/)).toBeInTheDocument();
    expect(screen.getByText(/• second/)).toBeInTheDocument();
  });

  it('leaves an unclosed marker as literal text instead of throwing', () => {
    render(<Wrapper text="half **open" />);
    expect(screen.getByText('half **open')).toBeInTheDocument();
  });

  it('does not let a marker span two lines', () => {
    render(<Wrapper text={'**start\nend**'} />);
    expect(screen.getByText(/\*\*start/)).toBeInTheDocument();
    expect(screen.queryByText('start', { selector: 'strong' })).not.toBeInTheDocument();
  });

  it('renders plain text with no markdown unchanged', () => {
    render(<Wrapper text="just a normal reply" />);
    expect(screen.getByText('just a normal reply')).toBeInTheDocument();
  });
});
