const LOCAL_ID = /^ari:cloud:ecosystem::extension\/([^/]+)\/([^/]+)\/static\/[^/]+$/;

/** Path of the app's global page from a module `localId`; null when the id has no app and environment parts. */
export function globalPagePath(localId) {
  const match = LOCAL_ID.exec(String(localId ?? ''));
  return match ? `/jira/apps/${match[1]}/${match[2]}` : null;
}
