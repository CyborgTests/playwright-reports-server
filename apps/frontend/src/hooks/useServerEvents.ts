import { useEffect, useRef } from 'react';

import { withBase } from '../lib/url';

export function useServerEvents(
  path: string,
  onChanged: () => void,
  options: { enabled?: boolean } = {}
): void {
  const enabled = options.enabled ?? true;
  const callbackRef = useRef(onChanged);
  callbackRef.current = onChanged;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }
    const source = new EventSource(withBase(path), { withCredentials: true });
    const handler = () => callbackRef.current();
    source.addEventListener('changed', handler);
    return () => {
      source.removeEventListener('changed', handler);
      source.close();
    };
  }, [path, enabled]);
}
