import { type ReactNode, useEffect, useRef, useState } from 'react';

interface LazyVisibleProps {
  children: ReactNode;
  rootMargin?: string;
  minHeight?: number;
  id?: string;
  className?: string;
}

export default function LazyVisible({
  children,
  rootMargin = '200px 0px',
  minHeight,
  id,
  className,
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

  return (
    <div
      ref={sentinelRef}
      id={id}
      className={className}
      style={!visible && minHeight ? { minHeight } : undefined}
      aria-hidden={visible ? undefined : true}
    >
      {visible ? children : null}
    </div>
  );
}
