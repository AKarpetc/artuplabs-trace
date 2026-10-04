import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api.js';

/**
 * Loads getStatus; polls every `everyMs` while mounted when given; `reload` refetches now.
 * Only the reply to the latest request is applied. A failure after data has loaded keeps that data and sets `stale` to the error.
 */
export function useStatus(everyMs = 0) {
  const [state, setState] = useState({ status: 'loading', stale: null });
  const latest = useRef(0);
  const load = useCallback(async () => {
    latest.current += 1;
    const ticket = latest.current;
    try {
      const data = await call('getStatus');
      if (ticket === latest.current) setState({ status: 'ready', data, stale: null });
    } catch (error) {
      if (ticket !== latest.current) return;
      setState((current) => (current.status === 'ready' ? { ...current, stale: error } : { status: 'error', error, stale: null }));
    }
  }, []);
  useEffect(() => {
    load();
    const timer = everyMs ? setInterval(load, everyMs) : null;
    return () => {
      if (timer) clearInterval(timer);
      latest.current += 1;
    };
  }, [load, everyMs]);
  return { ...state, reload: load };
}
