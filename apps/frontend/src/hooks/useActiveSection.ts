import { useEffect, useState } from 'react';

export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState<string>(ids[0] ?? '');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visible = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.boundingClientRect.top);
          } else {
            visible.delete(entry.target.id);
          }
        }
        if (visible.size === 0) return;
        const topmost = Array.from(visible.entries()).sort((a, b) => a[1] - b[1])[0][0];
        setActive(topmost);
      },
      // Reserve room for the sticky navbar and bias the "active" section toward
      // the top of the viewport so the user sees the nav highlight track the
      // section currently in reading position.
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);

  return active;
}
