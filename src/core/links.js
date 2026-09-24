/** Converts the issuelinks field of a requirement into flat link rows. */
export function extractLinks(issue) {
  const raw = issue.fields?.issuelinks ?? [];
  return raw
    .map((link) => {
      const other = link.inwardIssue ?? link.outwardIssue;
      if (!other) {
        return null;
      }
      return {
        linkId: String(link.id),
        reqIssueId: String(issue.id),
        otherIssueId: String(other.id),
        otherKey: other.key,
        otherTypeId: String(other.fields?.issuetype?.id ?? ''),
        otherStatus: other.fields?.status?.name ?? '',
        linkTypeId: String(link.type.id),
        linkTypeName: link.type.name,
        direction: link.inwardIssue ? 'in' : 'out',
      };
    })
    .filter(Boolean);
}

/** A requirement is covered when it links to a verification issue through an allowed link type. */
export function isCovered(links, config) {
  return links.some((l) => config.verificationTypeIds.includes(l.otherTypeId)
    && (config.linkTypeIds.length === 0 || config.linkTypeIds.includes(l.linkTypeId)));
}
