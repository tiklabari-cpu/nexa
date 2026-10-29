/**
 * The rating badge and comment (AR-03 · WG-11 · tm 337): words beside the
 * icon — never colour alone — "(with a comment)" when there is one, the
 * comment as plain text, a long one shortened until opened.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RATING_COMMENT_PREVIEW, RatingBadge, RatingComment } from './RatingBadge.js';

describe('RatingBadge', () => {
  it('names the rating in words, and says when it carries a comment', () => {
    const { rerender } = render(<RatingBadge value="bad" hasComment />);
    const badge = screen.getByTestId('rating-badge');
    expect(badge).toHaveTextContent('Rated bad (with a comment)');
    expect(badge).toHaveClass('text-danger');
    // The glyph is decoration; the words are what a screen reader hears.
    expect(badge.querySelector('[aria-hidden="true"]')).toHaveTextContent('👎');

    rerender(<RatingBadge value="good" hasComment={false} />);
    expect(screen.getByTestId('rating-badge')).toHaveTextContent('Rated good');
    expect(screen.getByTestId('rating-badge')).not.toHaveTextContent('comment');
  });
});

describe('RatingComment', () => {
  it('shows a short comment whole, as text and never as markup', () => {
    render(<RatingComment comment="<b>slow</b> & rude" />);
    const comment = screen.getByTestId('rating-comment');
    expect(comment).toHaveTextContent('<b>slow</b> & rude');
    expect(comment.querySelector('b')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shortens a long comment until "Show all", and folds it again', () => {
    const long = `${'Çekim bekliyor. '.repeat(20)}son`;
    render(<RatingComment comment={long} />);
    const comment = screen.getByTestId('rating-comment');
    expect(comment.textContent!.length).toBeLessThanOrEqual(RATING_COMMENT_PREVIEW + 1);
    expect(comment.textContent!.endsWith('…')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(comment).toHaveTextContent(long);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
