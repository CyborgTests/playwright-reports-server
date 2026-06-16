import { type ReactNode, useEffect, useRef, useState } from 'react';

interface LazyVisibleProps {
  children: ReactNode;
  rootMargin?: string;
  minHeight?: number;
}

/**
 * Render `children` only after the placeholder enters (or nears) the viewport.
 * Once shown, stays mounted — we don't unmount when the user scrolls back up,
 * so child queries can stay warm in the query cache.
 */
export default function LazyVisible({
  children,
  rootMargin = '200px 0px',
  minHeight,
}: Readonly<LazyVisibleProps>) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = sentinelRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  if (visible) return <>{children}</>;
  return <div ref={sentinelRef} style={minHeight ? { minHeight } : undefined} aria-hidden />;
}
