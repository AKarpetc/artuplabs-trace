import { useEffect, useState } from 'react';

/** Saved filters matching the typed text, asked `delay` ms after the last keystroke: `{ query, setQuery, filters, loading }`. */
export function useFilterSearch(client, { delay = 300 } = {}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ filters: [], loading: true });
  useEffect(() => {
    let live = true;
    setState((prev) => ({ ...prev, loading: true }));
    const timer = setTimeout(() => {
      client.searchFilters(query).then(
        (filters) => live && setState({ filters, loading: false }),
        () => live && setState({ filters: [], loading: false }),
      );
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, query, delay]);
  return { query, setQuery, ...state };
}
