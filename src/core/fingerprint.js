import { createHash } from 'node:crypto';

/** JSON serialisation with sorted object keys, so equal values give equal strings. */
export function stableStringify(value) {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 over the selected fields of a Jira issue; other fields do not affect it. */
export function fingerprint(issue, fieldIds) {
  const fields = issue.fields ?? {};
  const picked = [...fieldIds].sort().map((id) => [id, fields[id] ?? null]);
  return sha256(stableStringify(picked));
}

/** Order-independent hash of a requirement's links. */
export function linksHash(links) {
  const parts = links.map((l) => `${l.linkTypeId}:${l.direction}:${l.otherIssueId}`).sort();
  return sha256(parts.join('|'));
}
