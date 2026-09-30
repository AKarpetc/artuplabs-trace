import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AlignmentType, Document, Header, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

const OUTPUT = fileURLToPath(new URL('../public/example-template.docx', import.meta.url));
const COLUMNS = [['Key', '{{#issues}}{{key}}'], ['Summary', '{{summary}}'], ['Status', '{{status}}'], ['Assignee', '{{assignee}}{{/issues}}']];

const text = (value, run = {}) => new Paragraph({ children: [new TextRun({ text: value, ...run })] });
const cell = (value, bold = false) => new TableCell({ children: [text(value, { bold })] });

const header = new Header({
  children: [
    text('Jira export: {{jql}}'),
    text('Exported {{exportedAt}} by {{exportedBy}}'),
  ],
});

const table = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: COLUMNS.map(([title]) => cell(title, true)) }),
    new TableRow({ children: COLUMNS.map(([, tag]) => cell(tag)) }),
  ],
});

const details = [
  text('{{#issues}}'),
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '{{key}} {{summary}}' })] }),
  text('{{@description}}'),
  text('{{#comments}}'),
  text('{{author}}, {{created}}', { italics: true }),
  text('{{@body}}'),
  text('{{/comments}}'),
  text('{{/issues}}'),
];

const document = new Document({
  creator: 'ArtUp Reports',
  title: 'Example template',
  sections: [{
    headers: { default: header },
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.LEFT, children: [new TextRun({ text: '{{title}}' })] }),
      text('{{count}} issues'),
      table,
      new Paragraph({ children: [] }),
      ...details,
    ],
  }],
});

writeFileSync(OUTPUT, await Packer.toBuffer(document));
