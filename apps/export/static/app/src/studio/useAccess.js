import { useCallback, useEffect, useState } from 'react';
import { call } from '../api.js';

/** Licence check through the `getAccess` resolver: `status` is loading | licensed | unlicensed | error; `retry()` asks again. */
export function useAccess() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading', error: null });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', error: null });
    call('getAccess').then(
      (access) => live && setState({ status: access?.licensed === true ? 'licensed' : 'unlicensed', error: null }),
      (error) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
