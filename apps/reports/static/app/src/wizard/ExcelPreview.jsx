import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import Skeleton from '@atlaskit/skeleton';
import { token } from '@atlaskit/tokens';
import { router } from '@forge/bridge';
import { Anchor, Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { StepSection } from '../components/StepSection.jsx';
import { useLocale, useT } from '../i18n/index.js';
import { InlineState, JqlMessages, runErrorMessage } from './FailureView.jsx';
import { useExcelPreview } from './useExcelPreview.js';

const cardStyles = xcss({
  padding: 'space.300',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const tableStyles = xcss({ minWidth: '0', overflowX: 'auto', marginBlockEnd: 'space.negative.300' });
const cellStyles = xcss({ minWidth: '96px', overflowWrap: 'anywhere' });
const wideCellStyles = xcss({ minWidth: '200px' });
const LONG_TEXT = 24;
const jqlStyles = xcss({
  minWidth: '0',
  flexGrow: 1,
  flexBasis: '240px',
  fontFamily: 'font.family.code',
  fontSize: '12px',
  lineHeight: '20px',
  color: 'color.text.subtle',
  overflowWrap: 'anywhere',
});
const linkStyles = xcss({ color: 'color.link', textDecoration: 'none', ':hover': { textDecoration: 'underline' } });

/** Text of a preview cell as the file will show it: dates through `formats`, numbers through Intl. */
export function cellText(cell, formats, locale) {
  if (cell.kind === 'date') return formats.date(cell.value);
  if (cell.kind === 'datetime') return formats.dateTime(cell.value);
  if (cell.kind === 'number') {
    return new Intl.NumberFormat(locale, cell.percent ? { style: 'percent', maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(cell.value);
  }
  return cell.text ?? '';
}

function Cell({ cell, formats, locale }) {
  if (cell.kind === 'link') {
    const open = (event) => {
      event.preventDefault();
      router.open(cell.value);
    };
    return <Box xcss={cellStyles}><Anchor href={cell.value} onClick={open} xcss={linkStyles}>{cell.text}</Anchor></Box>;
  }
  const text = cellText(cell, formats, locale);
  return <Box xcss={[cellStyles, text.length > LONG_TEXT && wideCellStyles]}>{text}</Box>;
}

function Loading() {
  return (
    <Stack space="space.100" testId="preview-loading">
      {[0, 1, 2, 3, 4, 5].map((row) => <Skeleton key={row} width="100%" height="24px" borderRadius={token('radius.small')} />)}
    </Stack>
  );
}

function PreviewTable({ preview, formats }) {
  const t = useT();
  const locale = useLocale();
  const { sheet } = preview;
  const head = { cells: sheet.columns.map((column, index) => ({ key: `${column.id}-${index}`, content: column.header })) };
  const rows = sheet.rows.map((cells, row) => ({
    key: String(row),
    cells: cells.map((cell, index) => ({ key: `${row}-${index}`, content: <Cell cell={cell} formats={formats} locale={locale} /> })),
  }));
  return (
    <Stack space="space.200">
      <Flex gap="space.200" justifyContent="space-between" alignItems="center" wrap="wrap">
        <Box xcss={jqlStyles} testId="preview-jql">{preview.jql}</Box>
        <Text weight="semibold" testId="preview-count">{t('preview.count', { count: preview.count })}</Text>
      </Flex>
      <Box xcss={tableStyles} testId="preview-rows">
        <DynamicTable head={head} rows={rows} label={t('preview.title')} testId="preview-table" />
      </Box>
    </Stack>
  );
}

/**
 * Preview step (Excel): the first issues as rows of the first sheet, the JQL and how many issues match.
 * `blocked` is 'jql' (nothing typed yet), 'catalog' (fields still loading) or null.
 */
export function ExcelPreview({ number, createClient, request, blocked, labels, formats, onEditJql }) {
  const t = useT();
  const preview = useExcelPreview({ createClient, request: blocked ? null : request, labels, formats });
  let body;
  if (blocked === 'jql') {
    body = <InlineState text={t('preview.needsJql')} action={<Button onClick={onEditJql}>{t('preview.editJql')}</Button>} testId="preview-needs-jql" />;
  } else if (blocked || preview.status === 'loading' || preview.status === 'idle') {
    body = <Loading />;
  } else if (preview.status === 'empty') {
    body = <InlineState text={t('errors.noIssues')} action={onEditJql ? <Button onClick={onEditJql}>{t('preview.editJql')}</Button> : null} testId="preview-empty" />;
  } else if (preview.status === 'error') {
    body = (
      <Stack space="space.100" testId="preview-error">
        <InlineState tone="error" text={runErrorMessage(t, preview.error)} action={<Button onClick={preview.retry}>{t('errors.tryAgain')}</Button>} />
        <JqlMessages error={preview.error} />
      </Stack>
    );
  } else {
    body = <PreviewTable preview={preview} formats={formats} />;
  }
  return (
    <StepSection number={number} title={t('preview.title')} description={t('preview.description')}>
      <Box xcss={cardStyles} testId="excel-preview">{body}</Box>
    </StepSection>
  );
}
