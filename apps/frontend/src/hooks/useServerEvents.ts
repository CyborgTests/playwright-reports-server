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

    // Each SSE permanently holds one HTTP/1.1 connection from the shared
    // per-origin pool; an unfocused tab doesn't need live updates
    // so release the slot while backgrounded.
    let source: EventSource | null = null;
    const open = () => {
      if (source || document.visibilityState === 'hidden') return;
      source = new EventSource(withBase(path), { withCredentials: true });
      source.addEventListener('changed', handler);
    };
    const close = () => {
      source?.removeEventListener('changed', handler);
      source?.close();
      source = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') close();
      else open();
    };

    open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
    };
  }, [path, enabled]);
}
