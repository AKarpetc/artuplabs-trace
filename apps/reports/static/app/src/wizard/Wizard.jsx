import { useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import { Label } from '@atlaskit/form';
import SectionMessage from '@atlaskit/section-message';
import Textfield from '@atlaskit/textfield';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { entryLabel } from '../core/entry.js';
import { renderFileName } from '../core/filename.js';
import { DownloadIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { useLocale, useT } from '../i18n/index.js';
import { createBridgeClient } from '../infra/bridge.js';
import { saveBlob } from '../infra/download.js';
import { ColumnsEditor } from './ColumnsEditor.jsx';
import { ExcelPreview } from './ExcelPreview.jsx';
import { FailureView, IncompleteView, InlineState, runErrorMessage } from './FailureView.jsx';
import { FormatStep } from './FormatStep.jsx';
import { formatsFor, labelsFor } from './labels.js';
import { ResultView } from './ResultView.jsx';
import { RunningView } from './RunningView.jsx';
import { EntrySummary, JQL_FIELD_ID, SourceStep } from './SourceStep.jsx';
import { TemplatePicker } from './TemplatePicker.jsx';
import { useCatalog } from './useCatalog.js';
import { useExportRun } from './useExportRun.js';
import { useTemplates } from './useTemplates.js';
import { runEntry, runTemplate, useWizardForm } from './useWizardForm.js';

const TOKENS = ['{project}', '{date}', '{filter}', '{format}', '{count}'];

const footerStyles = xcss({
  paddingBlockStart: 'space.300',
  borderBlockStartWidth: 'border.width',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'color.border',
});
const nameFieldStyles = xcss({ minWidth: '0', flexGrow: 1, flexBasis: '280px', maxWidth: '560px' });
const codeStyles = xcss({ fontFamily: 'font.family.code', fontSize: '12px', lineHeight: '20px', color: 'color.text.subtle', overflowWrap: 'anywhere' });
const extensionStyles = xcss({ paddingInlineEnd: 'space.100', color: 'color.text.subtle', whiteSpace: 'nowrap' });

const focusJql = () => document.getElementById(JQL_FIELD_ID)?.focus();

function ExportBar({ form, entry, exportEntry, clock, onStart }) {
  const t = useT();
  const [now] = useState(() => new Date(clock()));
  const { format, fileNamePattern } = form.state;
  const example = renderFileName({
    pattern: fileNamePattern || undefined,
    values: { project: entry.projectKey ?? '', filter: entryLabel(exportEntry), format, count: '' },
    now,
    extension: format,
  });
  return (
    <Box xcss={footerStyles}>
      <Flex gap="space.300" alignItems="end" justifyContent="space-between" wrap="wrap">
        <Stack space="space.050" xcss={nameFieldStyles}>
          <Label htmlFor="wizard-file-name">{t('fileName.label')}</Label>
          <Textfield
            id="wizard-file-name"
            value={fileNamePattern}
            onChange={(event) => form.setFileNamePattern(event.currentTarget.value)}
            elemAfterInput={<Box as="span" xcss={extensionStyles}>{`.${format}`}</Box>}
            testId="wizard-file-name"
          />
          <Text size="small" color="color.text.subtle">{t('fileName.tokens')}</Text>
          <Box xcss={codeStyles}>{TOKENS.join('  ')}</Box>
          <Text size="small" color="color.text.subtle" testId="wizard-file-example">{t('fileName.example', { name: example })}</Text>
        </Stack>
        <Button appearance="primary" iconBefore={DownloadIcon} isDisabled={!form.canStart} onClick={onStart} testId="wizard-export">
          {t('export.button', { format: t(`format.${format}.title`) })}
        </Button>
      </Flex>
    </Box>
  );
}

function ColumnsStep({ number, form, catalog, labels }) {
  const t = useT();
  const { columns, rowMode, groupBy, summary } = form.state;
  return (
    <StepSection number={number} title={t('columns.title')} description={t('columns.description')}>
      {catalog.status === 'error' ? (
        <InlineState tone="error" text={runErrorMessage(t, catalog.error)} action={<Button onClick={catalog.retry}>{t('errors.tryAgain')}</Button>} testId="catalog-error" />
      ) : (
        <ColumnsEditor
          columns={columns}
          rowMode={rowMode}
          groupBy={groupBy}
          summary={summary}
          catalog={catalog.catalog}
          catalogLoading={catalog.status === 'loading'}
          labels={labels}
          onAdd={form.addColumn}
          onRemove={form.removeColumn}
          onMove={form.moveColumn}
          onRowMode={form.setRowMode}
          onGroupBy={form.setGroupBy}
          onSummary={form.setSummary}
        />
      )}
    </StepSection>
  );
}

function previewBlock(entry, form, catalog) {
  if (entry.kind === 'none' && form.state.jql.trim() === '') return 'jql';
  return catalog.status === 'ready' ? null : 'catalog';
}

/**
 * Export wizard for an entry point: source (global page), format, template, Excel columns and preview, then the run
 * (progress, cancel, incomplete, result, failure). Jira client, saving, renderers, clock and resolver calls are injectable.
 */
export function Wizard({
  entry, context, createClient = createBridgeClient, save = saveBlob, renderers, clock = Date.now, getPart, loadTemplates, language, compact = false, resultAction = null,
}) {
  const t = useT();
  const locale = useLocale();
  const client = useMemo(() => createClient({}), [createClient]);
  const form = useWizardForm(entry, language ? { language } : undefined);
  const catalog = useCatalog(client);
  const templates = useTemplates(entry, loadTemplates ? { client, load: loadTemplates } : { client });
  const run = useExportRun({ createClient, save, renderers, clock, getPart });
  const labels = useMemo(() => labelsFor(t), [t]);
  const formats = useMemo(() => formatsFor(locale), [locale]);
  const siteUrl = context?.siteUrl ?? '';
  const exportEntry = runEntry(form.state, entry);
  const template = runTemplate(form.state);
  const isExcel = form.state.format === 'xlsx';

  const start = () => run.start({ entry: exportEntry, template, siteUrl, labels, formats });
  const retry = () => run.start({ ...run.request, siteUrl, labels, formats });
  const switchToExcel = () => {
    form.setFormat('xlsx');
    run.reset();
  };

  const jqlFailure = run.state === 'failed' && run.error?.code === 'jql' && entry.kind === 'none';
  if (run.state === 'running') return <RunningView progress={run.progress} onCancel={run.cancel} clock={clock} compact={compact} />;
  if (run.state === 'incomplete') return <IncompleteView outcome={run.outcome} onRetry={run.retryMissing} onPartial={run.downloadPartial} onBack={run.reset} />;
  if (run.state === 'done') return <ResultView file={run.file} siteUrl={siteUrl} onDownloadAgain={run.download} onNewExport={run.reset} compact={compact} extraAction={resultAction} />;
  if (run.state === 'failed' && !jqlFailure) {
    return <FailureView error={run.error} onRetry={retry} onBack={run.reset} onSwitchToExcel={switchToExcel} />;
  }

  const jqlErrors = jqlFailure && run.request?.entry.jql === exportEntry.jql ? run.error.data.messages ?? [] : null;
  let step = 0;
  const next = () => {
    step += 1;
    return step;
  };
  return (
    <Stack space="space.400" testId="wizard">
      {run.cancelled ? <SectionMessage appearance="information" testId="run-cancelled"><Text>{t('run.cancelled')}</Text></SectionMessage> : null}
      {entry.kind === 'none'
        ? <SourceStep number={next()} form={form} client={client} jqlErrors={jqlErrors} />
        : <EntrySummary entry={entry} />}
      <FormatStep number={next()} form={form} />
      <TemplatePicker number={next()} form={form} templates={templates} />
      {isExcel ? <ColumnsStep number={next()} form={form} catalog={catalog} labels={labels} /> : null}
      {isExcel && catalog.status !== 'error' ? (
        <ExcelPreview
          number={next()}
          createClient={createClient}
          request={{ entry: exportEntry, template, catalog: catalog.catalog, siteUrl }}
          blocked={previewBlock(entry, form, catalog)}
          labels={labels}
          formats={formats}
          onEditJql={entry.kind === 'none' ? focusJql : null}
        />
      ) : null}
      <ExportBar form={form} entry={entry} exportEntry={exportEntry} clock={clock} onStart={start} />
    </Stack>
  );
}
