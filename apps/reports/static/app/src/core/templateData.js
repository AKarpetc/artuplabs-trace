import { blocksToText } from './adf.js';

function rich(name, blocks, toXml) {
  return { [name]: blocksToText(blocks), [`${name}__xml`]: toXml(blocks) };
}

function issueData(p, toXml) {
  return {
    key: p.key, url: p.url, summary: p.summary, status: p.status, assignee: p.assignee, reporter: p.reporter,
    priority: p.priority, type: p.type, due: p.due, created: p.created, updated: p.updated, resolved: p.resolved,
    resolution: p.resolution, labels: p.labels, components: p.components, fixVersions: p.fixVersions,
    project: p.project, parent: p.parent, timeSpent: p.timeSpent, estimate: p.estimate,
    ...rich('description', p.description, toXml),
    ...rich('environment', p.environment, toXml),
    fields: p.fields,
    comments: p.comments.map((c) => ({ author: c.author, created: c.created, ...rich('body', c.blocks, toXml) })),
    worklogs: p.worklogs.map((w) => ({ author: w.author, started: w.started, timeSpent: w.timeSpent, hours: w.hours, ...rich('comment', w.blocks, toXml) })),
    subtasks: p.subtasks,
    links: p.links,
  };
}

/** Data for a customer Word template: document tags, the first issue at the root, and all issues under `issues`. */
export function buildTemplateData({ issues, meta, toXml }) {
  const list = issues.map((p) => issueData(p, toXml));
  return {
    ...(list[0] ?? {}),
    jql: meta.jql, exportedBy: meta.exportedBy, exportedAt: meta.exportedAt, count: meta.count,
    title: meta.title ?? '', siteUrl: meta.siteUrl,
    issues: list,
  };
}
