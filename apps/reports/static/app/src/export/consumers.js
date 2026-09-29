import { FIELD_TAG, flattenTags } from '../core/placeholders.js';
import { buildLayout } from '../core/layouts.js';
import { imagesFor, prepareIssue } from '../core/prepare.js';
import { assembleSheets, createRowBuilder, createSummary } from '../core/rows.js';

function sheetConsumer({ template, catalog, meta, labels }) {
  const builder = createRowBuilder({ template, catalog, siteUrl: meta.siteUrl, labels });
  const summary = template.summary ? createSummary(labels) : null;
  return {
    consume(issue) {
      summary?.add(issue);
      return builder.rowsFor(issue);
    },
    imageIds: () => [],
    warnings: () => builder.missing.map((ref) => ({ kind: 'column-missing', detail: ref })),
    async render({ items, meta: fileMeta, renderers }) {
      const assembled = assembleSheets({ columns: builder.columns, rows: items.flat(), grouped: builder.grouped, summary: Boolean(summary), labels });
      return { bytes: await renderers.xlsx({ assembled, summary: summary?.result() ?? null, meta: fileMeta, labels }) };
    },
  };
}

function customFieldNames(template) {
  return flattenTags(template.placeholders ?? []).map((name) => FIELD_TAG.exec(name)?.[1]).filter(Boolean);
}

async function renderDocument({ template, items, meta, labels, images, renderers }) {
  if (template.kind === 'docx') {
    return { bytes: await renderers.docxTemplate({ template: template.bytes, issues: items, meta, images, labels }) };
  }
  const spec = buildLayout({ layout: template.layout, issues: items, meta, labels, paper: template.paper ?? meta.paper });
  if (template.format === 'pdf') return renderers.pdf({ spec, images, labels, meta });
  return { bytes: await renderers.docx({ spec, images, labels, meta }) };
}

function documentConsumer({ template, catalog, meta, labels, formats }) {
  const fieldNames = template.kind === 'docx' ? customFieldNames(template) : [];
  return {
    consume: (issue) => prepareIssue(issue, { catalog, siteUrl: meta.siteUrl, formats, fieldNames }),
    imageIds: (items) => [...new Set(items.flatMap((p) => imagesFor(template, p)))],
    warnings: (items, missing) => items.flatMap((p) => [
      ...p.warnings.map((w) => ({ ...w, issueKey: p.key })),
      ...imagesFor(template, p).filter((id) => missing.has(id)).map((id) => ({ kind: 'image-missing', detail: id, issueKey: p.key })),
    ]),
    render: ({ items, meta: fileMeta, images, renderers }) => renderDocument({ template, items, meta: fileMeta, labels, images, renderers }),
  };
}

/** Turns each fetched issue into what the chosen format keeps (rows or a prepared issue) and renders the file from those. */
export function createConsumer(options) {
  return options.template.kind === 'columns' ? sheetConsumer(options) : documentConsumer(options);
}
