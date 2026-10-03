import { useCallback, useEffect, useState } from 'react';
import { call } from '../api.js';

/** Loads getStatus; polls every `everyMs` while mounted when given; `reload` refetches now. */
export function useStatus(everyMs = 0) {
  const [state, setState] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await call('getStatus') });
    } catch (error) {
      setState({ status: 'error', error });
    }
  }, []);
  useEffect(() => {
    load();
    if (!everyMs) return undefined;
    const timer = setInterval(load, everyMs);
    return () => clearInterval(timer);
  }, [load, everyMs]);
  return { ...state, reload: load };
}
