import { useMemo, useReducer, useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import Textfield from '@atlaskit/textfield';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { renderFileName } from '../core/filename.js';
import { StepSection } from '../components/StepSection.jsx';
import { useT } from '../i18n/index.js';
import { ColumnsEditor } from '../wizard/ColumnsEditor.jsx';
import { InlineState, runErrorMessage } from '../wizard/FailureView.jsx';
import { formReducer, initialForm } from '../wizard/useWizardForm.js';
import { ScopePicker, scopeValue } from './ScopePicker.jsx';

const SAMPLE = { project: 'RPT', filter: 'Open issues', format: 'xlsx', count: '30' };
const TOKENS = ['{project}', '{date}', '{filter}', '{format}', '{count}'];
const NAME_LENGTH = 80;

const fieldStyles = xcss({ maxWidth: '560px', minWidth: '0' });
const codeStyles = xcss({ fontFamily: 'font.family.code', font: 'font.body.small', color: 'color.text.subtle', overflowWrap: 'anywhere' });
const extensionStyles = xcss({ paddingInlineEnd: 'space.100', color: 'color.text.subtle', whiteSpace: 'nowrap' });
const footerStyles = xcss({
  paddingBlockStart: 'space.300',
  borderBlockStartWidth: 'border.width',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'color.border',
});

function startingForm(template) {
  const base = initialForm({ kind: 'none' }, {});
  return template ? formReducer(base, { type: 'template', template }) : base;
}

function payloadOf({ template, name, scope, form }) {
  const { columns, rowMode, groupBy, summary, fileNamePattern } = form;
  return {
    ...(template ? { id: template.id } : {}),
    ...scope,
    name: name.trim(),
    format: 'xlsx',
    kind: 'columns',
    columns,
    rowMode,
    groupBy,
    summary,
    fileNamePattern,
  };
}

/**
 * Create or edit an Excel column template: name, columns (the wizard's editor), row mode, group-by, summary sheet,
 * file-name pattern with a live example, and scope. A saved template keeps its scope.
 */
export function ExcelTemplateForm({ template = null, admin, catalog, scopes, projects, labels, onDone, onCancel }) {
  const t = useT();
  const [form, dispatch] = useReducer(formReducer, template, startingForm);
  const [name, setName] = useState(template?.name ?? '');
  const [scope, setScope] = useState(template ? { scope: template.scope, scopeId: template.scopeId } : scopeValue('user', scopes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [now] = useState(() => new Date());
  const actions = useMemo(() => ({
    onAdd: (ref) => dispatch({ type: 'addColumn', ref }),
    onRemove: (index) => dispatch({ type: 'removeColumn', index }),
    onMove: (from, to) => dispatch({ type: 'moveColumn', from, to }),
    onRowMode: (rowMode) => dispatch({ type: 'rowMode', rowMode }),
    onGroupBy: (groupBy) => dispatch({ type: 'groupBy', groupBy }),
    onSummary: (summary) => dispatch({ type: 'summary', summary }),
  }), []);
  const example = renderFileName({ pattern: form.fileNamePattern || undefined, values: SAMPLE, now, extension: 'xlsx' });
  const canSave = name.trim() !== '' && form.columns.length > 0 && (scope.scope !== 'project' || scope.scopeId !== '') && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await admin.save(payloadOf({ template, name, scope, form }));
      onDone();
    } catch (failure) {
      setError(failure);
      setSaving(false);
    }
  };

  return (
    <Stack space="space.400" testId="excel-template-form">
      <Heading size="medium" as="h2">{template ? t('templates.editing', { name: template.name }) : t('templates.kind.xlsx.title')}</Heading>
      <StepSection number={1} title={t('templates.form.name')}>
        <Box xcss={fieldStyles}>
          <Textfield id="template-name" aria-label={t('templates.form.name')} value={name} maxLength={NAME_LENGTH} onChange={(event) => setName(event.currentTarget.value)} testId="template-name" />
        </Box>
      </StepSection>
      <StepSection number={2} title={t('columns.title')} description={t('columns.description')}>
        {catalog.status === 'error' ? (
          <InlineState tone="error" text={runErrorMessage(t, catalog.error)} action={<Button onClick={catalog.retry}>{t('errors.tryAgain')}</Button>} testId="catalog-error" />
        ) : (
          <ColumnsEditor
            columns={form.columns}
            rowMode={form.rowMode}
            groupBy={form.groupBy}
            summary={form.summary}
            catalog={catalog.catalog}
            catalogLoading={catalog.status === 'loading'}
            labels={labels}
            {...actions}
          />
        )}
      </StepSection>
      <StepSection number={3} title={t('fileName.label')}>
        <Stack space="space.050" xcss={fieldStyles}>
          <Textfield
            id="template-file-name"
            aria-label={t('fileName.label')}
            value={form.fileNamePattern}
            onChange={(event) => dispatch({ type: 'fileNamePattern', fileNamePattern: event.currentTarget.value })}
            elemAfterInput={<Box as="span" xcss={extensionStyles}>.xlsx</Box>}
            testId="template-file-pattern"
          />
          <Text size="small" color="color.text.subtle">{t('fileName.tokens')}</Text>
          <Box xcss={codeStyles}>{TOKENS.join('  ')}</Box>
          <Text size="small" color="color.text.subtle" testId="template-file-example">{t('fileName.example', { name: example })}</Text>
        </Stack>
      </StepSection>
      <StepSection number={4} title={t('templates.scope.title')} description={t('templates.scope.description')}>
        <ScopePicker scopes={scopes} projects={projects} value={scope} onChange={setScope} disabled={template !== null} />
      </StepSection>
      {error ? <SectionMessage appearance="error" testId="template-save-error"><Text>{runErrorMessage(t, error)}</Text></SectionMessage> : null}
      <Box xcss={footerStyles}>
        <Flex gap="space.100" justifyContent="end" wrap="wrap">
          <Button appearance="subtle" onClick={onCancel} isDisabled={saving} testId="template-cancel">{t('templates.form.cancel')}</Button>
          <Button appearance="primary" onClick={save} isDisabled={!canSave} isLoading={saving} testId="template-save">{t('templates.form.save')}</Button>
        </Flex>
      </Box>
    </Stack>
  );
}
