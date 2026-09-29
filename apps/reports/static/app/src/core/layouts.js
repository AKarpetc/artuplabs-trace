const para = (runs) => ({ type: 'para', runs: typeof runs === 'string' ? (runs ? [{ text: runs }] : []) : runs });
const heading = (level, runs) => ({ type: 'heading', level, runs: typeof runs === 'string' ? [{ text: runs }] : runs });
const keyRun = (issue) => [{ text: issue.key, link: issue.url, bold: true }];
const cellOf = (value, header) => ({
  header, colspan: 1, rowspan: 1,
  blocks: [para(typeof value === 'string' ? (value ? [{ text: value, ...(header ? { bold: true } : {}) }] : []) : value)],
});

function table(headers, rows) {
  return {
    type: 'table',
    header: true,
    rows: [{ cells: headers.map((h) => cellOf(h, true)) }, ...rows.map((r) => ({ cells: r.map((v) => cellOf(v, false)) }))],
  };
}

function keyValues(issue, labels) {
  const pairs = [
    ['layout.type', issue.type], ['layout.status', issue.status], ['layout.priority', issue.priority],
    ['layout.assignee', issue.assignee], ['layout.reporter', issue.reporter], ['layout.created', issue.created],
    ['layout.updated', issue.updated], ['layout.due', issue.due], ['layout.labels', issue.labels],
    ['layout.components', issue.components], ['layout.fixVersions', issue.fixVersions],
  ].filter(([, value]) => value);
  return {
    type: 'table',
    header: false,
    rows: pairs.map(([key, value]) => ({ cells: [cellOf([{ text: labels[key], bold: true }], false), cellOf(value, false)] })),
  };
}

function singleIssue(issue, labels) {
  const out = [heading(1, [...keyRun(issue), { text: ` ${issue.summary}` }]), keyValues(issue, labels)];
  if (issue.description.length) out.push(heading(2, labels['layout.description']), ...issue.description);
  if (issue.gallery.length) {
    out.push(heading(2, labels['layout.attachments']), ...issue.gallery.map((id) => ({ type: 'image', attachmentId: id, alt: '', width: null, height: null })));
  }
  if (issue.subtasks.length) {
    out.push(heading(2, labels['layout.subtasks']), table(
      [labels['layout.key'], labels['layout.summary'], labels['layout.status']],
      issue.subtasks.map((s) => [[{ text: s.key, link: s.url }], s.summary, s.status]),
    ));
  }
  if (issue.links.length) {
    out.push(heading(2, labels['layout.links']), table(
      [labels['layout.type'], labels['layout.key'], labels['layout.summary'], labels['layout.status']],
      issue.links.map((l) => [l.type, [{ text: l.key, link: l.url }], l.summary, l.status]),
    ));
  }
  if (issue.comments.length) {
    out.push(heading(2, labels['layout.comments']));
    for (const c of issue.comments) out.push(para([{ text: `${c.author} · ${c.created}`, bold: true }]), ...c.blocks);
  }
  return out;
}

function groupBy(issues, keyOf) {
  const groups = new Map();
  for (const issue of issues) {
    const key = keyOf(issue);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  return groups;
}

const sumPoints = (issues) => issues.reduce((sum, i) => sum + (i.storyPointsValue ?? 0), 0);
const fmt = (n) => String(Number(n.toFixed(2)));

function listLayout(issues, labels, title) {
  return [
    heading(1, title),
    table(
      ['layout.key', 'layout.summary', 'layout.type', 'layout.status', 'layout.priority', 'layout.assignee', 'layout.due'].map((k) => labels[k]),
      issues.map((i) => [keyRun(i), i.summary, i.type, i.status, i.priority, i.assignee, i.due]),
    ),
  ];
}

function sprintLayout(issues, labels, title) {
  const groups = groupBy(issues, (i) => i.status || labels['layout.untitled']);
  const statusRows = [...groups.entries()].map(([status, list]) => [status, String(list.length), fmt(sumPoints(list))]);
  const total = [[{ text: labels['layout.total'], bold: true }], String(issues.length), fmt(sumPoints(issues))];
  const out = [
    heading(1, title),
    para(`${labels['layout.count']}: ${issues.length}`),
    table([labels['layout.status'], labels['layout.count'], labels['layout.points']], [...statusRows, total]),
  ];
  for (const [status, list] of groups) {
    out.push(heading(2, status), table(
      [labels['layout.key'], labels['layout.summary'], labels['layout.assignee'], labels['layout.points']],
      list.map((i) => [keyRun(i), i.summary, i.assignee, i.storyPoints]),
    ));
  }
  return out;
}

function releaseLayout(issues, labels, title) {
  const out = [heading(1, title)];
  for (const [type, list] of groupBy(issues, (i) => i.type || labels['layout.untitled'])) {
    out.push(heading(2, type), {
      type: 'list', ordered: false, start: 1,
      items: list.map((i) => ({ blocks: [para([...keyRun(i), { text: ` ${i.summary}` }])] })),
    });
  }
  return out;
}

const BODIES = {
  single: (issues, labels) => issues.flatMap((issue, i) => [...(i > 0 ? [{ type: 'pageBreak' }] : []), ...singleIssue(issue, labels)]),
  list: listLayout,
  sprint: sprintLayout,
  release: releaseLayout,
};

function titleOf(layout, issues, meta, fallback) {
  if (meta.title) return meta.title;
  if (layout === 'single') return issues.length === 1 ? `${issues[0].key} ${issues[0].summary}` : fallback;
  if (layout === 'sprint') return issues[0]?.sprint || fallback;
  if (layout === 'release') return issues[0]?.fixVersions || fallback;
  return fallback;
}

/** Document spec of a built-in Word/PDF layout: title, first-page meta lines and blocks. */
export function buildLayout({ layout, issues, meta, labels, paper }) {
  const title = titleOf(layout, issues, meta, labels['layout.untitled']);
  const body = Object.hasOwn(BODIES, layout) ? BODIES[layout](issues, labels, title) : [];
  const banner = meta.partial
    ? [{ type: 'panel', kind: 'warning', blocks: [para(labels.partialBanner(meta.partial.done, meta.partial.total))] }]
    : [];
  return {
    paper,
    title,
    metaLines: [
      `${labels['meta.jql']}: ${meta.jql}`,
      `${labels['meta.exported']}: ${meta.exportedAt} · ${meta.exportedBy}`,
      `${labels['meta.count']}: ${meta.count}`,
    ],
    blocks: [...banner, ...body],
  };
}
