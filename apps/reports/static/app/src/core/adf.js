import { EXCEL_CELL_LIMIT } from './limits.js';

const FLAG = { strong: 'bold', em: 'italic', code: 'code', strike: 'strike', underline: 'underline' };

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

function markedRun(node) {
  const run = { text: node.text ?? '' };
  for (const mark of node.marks ?? []) {
    if (FLAG[mark.type]) run[FLAG[mark.type]] = true;
    if (mark.type === 'link' && mark.attrs?.href) run.link = mark.attrs.href;
    if (mark.type === 'textColor' && mark.attrs?.color) run.color = mark.attrs.color;
    if (mark.type === 'subsup' && (mark.attrs?.type === 'sub' || mark.attrs?.type === 'sup')) run[mark.attrs.type] = true;
  }
  return run;
}

const linkRun = (url) => ({ text: url, link: url });

function inlineRun(node, ctx) {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'text': return markedRun(node);
    case 'hardBreak': return { text: '\n' };
    case 'mention': {
      const text = String(attrs.text ?? '');
      return { text: text.startsWith('@') ? text : `@${text || 'user'}` };
    }
    case 'emoji': return { text: attrs.text ?? attrs.shortName ?? '' };
    case 'date': return { text: ctx.formatDate(Number(attrs.timestamp)) };
    case 'status': return { text: `[${String(attrs.text ?? '').toUpperCase()}]`, bold: true };
    case 'inlineCard': return linkRun(attrs.url ?? attrs.data?.url ?? '');
    case 'mediaInline': return { text: attrs.alt ?? '' };
    case 'placeholder': return null;
    default:
      ctx.warnings.push({ kind: 'adf-fallback', detail: node.type });
      return { text: textOf(node) };
  }
}

function inlineRuns(nodes, ctx) {
  return (nodes ?? []).map((n) => inlineRun(n, ctx)).filter((r) => r && r.text !== '');
}

function listItems(nodes, ctx) {
  return (nodes ?? []).map((item) => ({ blocks: blocksOf(item.content ?? [], ctx) }));
}

function checkItems(nodes, ctx, prefix) {
  return (nodes ?? []).map((item) => {
    const inline = (item.content ?? []).filter((n) => !['taskList', 'decisionList'].includes(n.type));
    const nested = (item.content ?? []).filter((n) => ['taskList', 'decisionList'].includes(n.type));
    return { blocks: [{ type: 'para', runs: [{ text: prefix(item) }, ...inlineRuns(inline, ctx)] }, ...blocksOf(nested, ctx)] };
  });
}

function mediaBlock(node, ctx) {
  const attrs = node.attrs ?? {};
  if (attrs.type === 'external') {
    ctx.warnings.push({ kind: 'image-external', detail: attrs.url ?? '' });
    return { type: 'image', attachmentId: null, alt: attrs.url ?? '', width: attrs.width ?? null, height: attrs.height ?? null };
  }
  const index = ctx.mediaIndex;
  ctx.mediaIndex += 1;
  const attachmentId = ctx.resolveMedia(attrs, index);
  if (!attachmentId) ctx.warnings.push({ kind: 'image-unresolved', detail: attrs.alt ?? '' });
  return { type: 'image', attachmentId: attachmentId ?? null, alt: attrs.alt ?? '', width: attrs.width ?? null, height: attrs.height ?? null };
}

function tableBlock(node, ctx) {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow').map((row) => ({
    cells: (row.content ?? []).map((c) => ({
      header: c.type === 'tableHeader',
      colspan: c.attrs?.colspan ?? 1,
      rowspan: c.attrs?.rowspan ?? 1,
      blocks: blocksOf(c.content ?? [], ctx),
    })),
  }));
  const header = rows.length > 1 && rows[0].cells.length > 0 && rows[0].cells.every((c) => c.header);
  return { type: 'table', header, rows };
}

function block(node, ctx) {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph': return [{ type: 'para', runs: inlineRuns(node.content, ctx) }];
    case 'heading': return [{ type: 'heading', level: Math.min(6, Math.max(1, attrs.level ?? 1)), runs: inlineRuns(node.content, ctx) }];
    case 'bulletList': return [{ type: 'list', ordered: false, start: 1, items: listItems(node.content, ctx) }];
    case 'orderedList': return [{ type: 'list', ordered: true, start: attrs.order ?? 1, items: listItems(node.content, ctx) }];
    case 'taskList': return [{ type: 'list', ordered: false, start: 1, items: checkItems(node.content, ctx, (i) => (i.attrs?.state === 'DONE' ? '[x] ' : '[ ] ')) }];
    case 'decisionList': return [{ type: 'list', ordered: false, start: 1, items: checkItems(node.content, ctx, () => '» ') }];
    case 'listItem': case 'layoutColumn': return blocksOf(node.content ?? [], ctx);
    case 'layoutSection': return (node.content ?? []).flatMap((col) => blocksOf(col.content ?? [], ctx));
    case 'codeBlock': return [{ type: 'code', language: attrs.language ?? '', text: textOf(node) }];
    case 'blockquote': return [{ type: 'quote', blocks: blocksOf(node.content ?? [], ctx) }];
    case 'panel': return [{ type: 'panel', kind: attrs.panelType ?? 'info', blocks: blocksOf(node.content ?? [], ctx) }];
    case 'rule': return [{ type: 'rule' }];
    case 'table': return [tableBlock(node, ctx)];
    case 'mediaSingle': case 'mediaGroup': return (node.content ?? []).filter((n) => n.type === 'media').map((n) => mediaBlock(n, ctx));
    case 'media': return [mediaBlock(node, ctx)];
    case 'expand': case 'nestedExpand': {
      const title = attrs.title ? [{ type: 'para', runs: [{ text: attrs.title, bold: true }] }] : [];
      return [...title, ...blocksOf(node.content ?? [], ctx)];
    }
    case 'blockCard': case 'embedCard': return [{ type: 'para', runs: [linkRun(attrs.url ?? attrs.data?.url ?? '')] }];
    default: {
      ctx.warnings.push({ kind: 'adf-fallback', detail: node.type });
      const text = textOf(node);
      return text ? [{ type: 'para', runs: [{ text }] }] : [];
    }
  }
}

function blocksOf(nodes, ctx) {
  return nodes.flatMap((n) => block(n, ctx));
}

/** Converts an ADF document to the neutral document model; unknown nodes become text with a warning. */
export function adfToModel(doc, options = {}) {
  const ctx = {
    warnings: [],
    mediaIndex: 0,
    resolveMedia: options.resolveMedia ?? (() => null),
    formatDate: options.formatDate ?? isoDate,
  };
  const blocks = blocksOf(doc?.content ?? [], ctx);
  return { blocks, warnings: ctx.warnings };
}

const runsText = (runs) => runs.map((r) => r.text).join('');

function blockText(b, depth) {
  switch (b.type) {
    case 'para': case 'heading': return runsText(b.runs);
    case 'code': return b.text;
    case 'rule': return '---';
    case 'image': return `[${b.alt || 'image'}]`;
    case 'quote': case 'panel': return blocksToText(b.blocks, depth);
    case 'list': return b.items.map((item, i) => {
      const marker = b.ordered ? `${(b.start ?? 1) + i}. ` : '• ';
      const [first = '', ...rest] = blocksToText(item.blocks, depth + 1).split('\n');
      return [`${'  '.repeat(depth)}${marker}${first}`, ...rest].join('\n');
    }).join('\n');
    case 'table': return b.rows.map((r) => r.cells.map((c) => blocksToText(c.blocks).replace(/\n/g, ' ')).join(' | ')).join('\n');
    default: return '';
  }
}

/** Plain text of a model: lists with markers and two-space indentation, table cells joined by ' | '. */
export function blocksToText(blocks, depth = 0) {
  return blocks.map((b) => blockText(b, depth)).filter((text) => text !== '').join('\n');
}

/** Cuts text to the Excel cell limit and appends how many characters were cut. */
export function truncateCell(text, limit = EXCEL_CELL_LIMIT) {
  if (text.length <= limit) return text;
  let cut = limit - 16;
  if (/[\uD800-\uDBFF]/.test(text[cut - 1])) cut -= 1;
  return `${text.slice(0, cut)} …[+${text.length - cut}]`;
}
