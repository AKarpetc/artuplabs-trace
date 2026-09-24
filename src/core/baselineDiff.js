import { createHash } from 'node:crypto';

/** Classifies one issue between a left and right baseline. */
export function classifyDiffRow({ leftVersionId, rightVersionId, leftLinksHash, rightLinksHash }) {
  if (leftVersionId == null) {
    return 'added';
  }
  if (rightVersionId == null) {
    return 'removed';
  }
  if (String(leftVersionId) !== String(rightVersionId)) {
    return 'changed';
  }
  return leftLinksHash === rightLinksHash ? 'unchanged' : 'links-changed';
}

/** SHA-256 over sorted issueId:fingerprint:linksHash triples; proves a baseline was not altered. */
export function baselineChecksum(members) {
  const text = [...members]
    .sort((a, b) => (a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0))
    .map((m) => `${m.issueId}:${m.fingerprint}:${m.linksHash}`)
    .join('\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
