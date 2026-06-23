import { useEffect, useRef } from 'react';

import { withBase } from '../lib/url';

export function useServerEvents(
  path: string,
  onChanged: (data?: unknown) => void,
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
    const handler = (event: Event) => {
      const raw = (event as MessageEvent).data;
      let data: unknown;
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = undefined;
        }
      }
      callbackRef.current(data);
    };
    source.addEventListener('changed', handler);
    return () => {
      source.removeEventListener('changed', handler);
      source.close();
    };
  }, [path, enabled]);
}
