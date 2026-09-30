import { useEffect, useMemo, useState } from 'react';

/** The entry with its saved filter's name as label once Jira returns it; the entry unchanged while loading or when the read fails. */
export function useNamedEntry(entry, client) {
  const filterId = entry.kind === 'jql' && !entry.label ? entry.filterId : undefined;
  const [named, setNamed] = useState(null);
  useEffect(() => {
    if (!filterId) return undefined;
    let live = true;
    client.filterName(filterId).then(
      (name) => live && name && setNamed({ filterId, name }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, filterId]);
  return useMemo(() => (named && named.filterId === filterId ? { ...entry, label: named.name } : entry), [entry, named, filterId]);
}
