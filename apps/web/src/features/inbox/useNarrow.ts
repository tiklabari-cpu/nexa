import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Whether the element is narrower than `threshold` px, measured live.
 *
 * The transcript header cannot ask the viewport: its room is what is left after
 * the rail, the list and the right panel, and that changes when the panel is
 * collapsed. Where nothing can be measured (jsdom reports 0, an old browser has
 * no `ResizeObserver`) the answer is "not narrow", so the full layout renders.
 */
export function useNarrow<T extends HTMLElement>(threshold: number): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [narrow, setNarrow] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.clientWidth;
      setNarrow(width > 0 && width < threshold);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, narrow];
}
