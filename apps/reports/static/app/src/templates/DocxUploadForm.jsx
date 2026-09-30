import { useEffect, useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import ProgressBar from '@atlaskit/progress-bar';
import SectionMessage from '@atlaskit/section-message';
import Textfield from '@atlaskit/textfield';
import { token } from '@atlaskit/tokens';
import { Box, Flex, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { DOC_TAGS, ISSUE_TAGS, ITEM_TAGS, flattenTags } from '../core/placeholders.js';
import { TEMPLATE_MAX_BYTES } from '../core/limits.js';
import { ChevronDownIcon, ChevronRightIcon, DownloadIcon, UploadIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { formatBytes, useLocale, useT } from '../i18n/index.js';
import { saveBlob } from '../infra/download.js';
import { InlineState, runErrorMessage } from '../wizard/FailureView.jsx';
import { ScopePicker, scopeValue } from './ScopePicker.jsx';
import { fromBase64, inspectUpload } from './upload.js';
import exampleDataUrl from '../../public/example-template.docx?inline';

const NAME_LENGTH = 80;
const MAX_SHOWN_ERRORS = 20;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXAMPLE_NAME = 'example-template.docx';
const NESTED_LOOPS = Object.keys(ITEM_TAGS);

const fieldStyles = xcss({ maxWidth: '560px', minWidth: '0' });
const zoneStyles = xcss({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'space.100',
  boxSizing: 'border-box',
  padding: 'space.400',
  textAlign: 'center',
  cursor: 'pointer',
  borderWidth: 'border.width.selected',
  borderStyle: 'dashed',
  borderColor: 'color.border.bold',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface',
  ':hover': { backgroundColor: 'elevation.surface.hovered' },
  ':focus-within': {
    outlineWidth: 'border.width.focused',
    outlineStyle: 'solid',
    outlineColor: 'color.border.focused',
    outlineOffset: 'space.025',
  },
});
const overStyles = xcss({ borderColor: 'color.border.selected', backgroundColor: 'color.background.selected' });
const zoneTextStyles = xcss({ overflowWrap: 'anywhere', minWidth: '0' });
const codeStyles = xcss({
  fontFamily: 'font.family.code',
  font: 'font.body.small',
  paddingInline: 'space.050',
  borderRadius: 'radius.small',
  backgroundColor: 'color.background.neutral',
  overflowWrap: 'anywhere',
});
const referenceStyles = xcss({
  padding: 'space.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
});
const footerStyles = xcss({
  paddingBlockStart: 'space.300',
  borderBlockStartWidth: 'border.width',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'color.border',
});
const hiddenInput = { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', pointerEvents: 'none' };

const tagText = (name) => `{{${name}}}`;
const withoutExtension = (fileName) => fileName.replace(/\.docx$/i, '').slice(0, NAME_LENGTH);

function errorText(t, error) {
  switch (error.kind) {
    case 'unknown-tag': return t('templates.error.unknown-tag', { tag: tagText(error.tag) });
    case 'unknown-field': return t('templates.error.unknown-field', { tag: tagText(error.tag) });
    case 'not-rich': return t('templates.error.not-rich', { tag: tagText(`@${error.tag}`) });
    case 'syntax': return error.tag === undefined
      ? t('templates.error.syntax', { detail: error.detail })
      : t('templates.error.syntaxTag', { tag: tagText(error.tag), detail: error.detail });
    case 'not-docx': return t('templates.error.not-docx');
    case 'too-large': return t('errors.too-large');
    case 'unpacked-too-large': return t('templates.error.unpacked');
    default: return t('errors.generic', { message: error.kind });
  }
}

function suggestionText(t, error) {
  if (!error.suggestion) return null;
  const name = error.kind === 'unknown-field' ? `field "${error.suggestion}"` : error.suggestion;
  return t('templates.error.suggestion', { suggestion: tagText(name) });
}

function TemplateErrors({ errors }) {
  const t = useT();
  return (
    <Stack space="space.100" testId="template-errors">
      {errors.slice(0, MAX_SHOWN_ERRORS).map((error, index) => {
        const suggestion = suggestionText(t, error);
        return (
          <SectionMessage key={index} appearance="error" title={errorText(t, error)} testId={`template-error-${index}`}>
            {suggestion ? <Text>{suggestion}</Text> : null}
          </SectionMessage>
        );
      })}
    </Stack>
  );
}

function TagList({ title, tags }) {
  return (
    <Stack space="space.050">
      <Text weight="semibold">{title}</Text>
      <Inline space="space.075" rowSpace="space.075" shouldWrap>
        {tags.map((name) => <Box as="span" key={name} xcss={codeStyles}>{tagText(name)}</Box>)}
      </Inline>
    </Stack>
  );
}

function TagsReference() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Stack space="space.100" testId="tags-reference">
      <Box>
        <Button appearance="subtle" iconBefore={open ? ChevronDownIcon : ChevronRightIcon} onClick={() => setOpen(!open)} aria-expanded={open} testId="tags-toggle">
          {t('templates.tags.title')}
        </Button>
      </Box>
      {open ? (
        <Stack space="space.200" xcss={referenceStyles} testId="tags-content">
          <TagList title={t('templates.tags.doc')} tags={DOC_TAGS} />
          <TagList title={t('templates.tags.loop', { loop: tagText('#issues') })} tags={Object.keys(ISSUE_TAGS)} />
          {NESTED_LOOPS.map((loop) => <TagList key={loop} title={t('templates.tags.loop', { loop: tagText(`#${loop}`) })} tags={ITEM_TAGS[loop]} />)}
          <Text color="color.text.subtle">{t('templates.tags.rich', { tag: tagText('@description') })}</Text>
          <Text color="color.text.subtle">{t('templates.tags.field', { tag: tagText('field "Story Points"') })}</Text>
        </Stack>
      ) : null}
    </Stack>
  );
}

function DropZone({ file, onFile }) {
  const t = useT();
  const locale = useLocale();
  const [over, setOver] = useState(false);
  const stop = (event) => event.preventDefault();
  return (
    <Box
      as="label"
      htmlFor="template-file"
      xcss={[zoneStyles, over && overStyles]}
      onDragOver={(event) => {
        stop(event);
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        stop(event);
        setOver(false);
        if (event.dataTransfer?.files?.[0]) onFile(event.dataTransfer.files[0]);
      }}
      testId="template-dropzone"
      data-over={over ? 'true' : undefined}
    >
      <input
        id="template-file"
        type="file"
        accept=".docx"
        style={hiddenInput}
        onChange={(event) => {
          if (event.currentTarget.files?.[0]) onFile(event.currentTarget.files[0]);
          event.currentTarget.value = '';
        }}
        data-testid="template-file"
      />
      <UploadIcon label="" color={token('color.icon.subtle')} />
      <Box xcss={zoneTextStyles}>
        <Text weight="semibold">{file ? file.name : t('templates.drop.title')}</Text>
      </Box>
      <Text size="small" color="color.text.subtle">
        {file ? t('templates.drop.chosen', { size: formatBytes(locale, file.size) }) : t('templates.drop.hint', { size: formatBytes(locale, TEMPLATE_MAX_BYTES) })}
      </Text>
    </Box>
  );
}

function InspectionStatus({ inspection, template, file }) {
  const t = useT();
  if (!file) return template ? <Text color="color.text.subtle">{t('templates.upload.keepCurrent')}</Text> : null;
  if (inspection.status !== 'done') return <Text color="color.text.subtle" testId="template-checking">{t('templates.upload.checking')}</Text>;
  if (inspection.errors.length > 0) return <TemplateErrors errors={inspection.errors} />;
  return <SectionMessage appearance="success" testId="template-valid"><Text>{t('templates.upload.ok', { count: flattenTags(inspection.tags).length })}</Text></SectionMessage>;
}

function payloadOf({ template, name, scope, placeholders }) {
  return { ...(template ? { id: template.id } : {}), ...scope, name: name.trim(), format: 'docx', kind: 'docx', placeholders };
}

/**
 * Create or edit a Word template: name, a .docx dropped or chosen and inspected at once (problems listed with suggestions,
 * Save blocked while any remain), tag reference, example download, scope. Saving stores the metadata and then the file part by part.
 */
export function DocxUploadForm({ template = null, admin, catalog, scopes, projects, onDone, onCancel, save = saveBlob, loadLibs }) {
  const t = useT();
  const [name, setName] = useState(template?.name ?? '');
  const [scope, setScope] = useState(template ? { scope: template.scope, scopeId: template.scopeId } : scopeValue('user', scopes));
  const [file, setFile] = useState(null);
  const [inspection, setInspection] = useState({ status: 'idle', tags: [], errors: [] });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const ready = catalog.status === 'ready';
  const fieldNames = useMemo(() => (ready ? catalog.catalog.list.map((field) => field.name) : []), [ready, catalog.catalog]);

  useEffect(() => {
    if (!file || !ready) return undefined;
    let live = true;
    setInspection({ status: 'checking', tags: [], errors: [] });
    inspectUpload(file.bytes, { fieldNames, ...(loadLibs ? { loadLibs } : {}) }).then(
      (result) => live && setInspection({ status: 'done', ...result }),
      () => live && setInspection({ status: 'done', tags: [], errors: [{ kind: 'not-docx' }] }),
    );
    return () => {
      live = false;
    };
  }, [file, ready, fieldNames, loadLibs]);

  const choose = async (chosen) => {
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    setFile({ name: chosen.name, size: chosen.size, bytes });
    setInspection({ status: 'idle', tags: [], errors: [] });
    setFailure(null);
    setName((current) => (current.trim() === '' ? withoutExtension(chosen.name) : current));
  };

  const checked = file === null ? template !== null : inspection.status === 'done' && inspection.errors.length === 0;
  const canSave = name.trim() !== '' && checked && !busy && (scope.scope !== 'project' || scope.scopeId !== '');

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    setProgress(0);
    let phase = 'save';
    try {
      const placeholders = file ? [...new Set(flattenTags(inspection.tags))] : template?.placeholders ?? [];
      const known = template ?? (savedId ? { id: savedId } : null);
      const { id } = await admin.save(payloadOf({ template: known, name, scope, placeholders }));
      setSavedId(id);
      if (file) {
        phase = 'upload';
        await admin.upload(id, file.bytes, setProgress);
      }
      onDone();
    } catch (error) {
      setFailure({ error, phase });
      setBusy(false);
    }
  };

  const downloadExample = () => save(EXAMPLE_NAME, new Blob([fromBase64(exampleDataUrl.slice(exampleDataUrl.indexOf(',') + 1))], { type: DOCX_MIME }));

  return (
    <Stack space="space.400" testId="docx-upload-form">
      <Heading size="medium" as="h2">{template ? t('templates.editing', { name: template.name }) : t('templates.kind.docx.title')}</Heading>
      <StepSection number={1} title={t('templates.form.name')}>
        <Box xcss={fieldStyles}>
          <Textfield id="template-name" aria-label={t('templates.form.name')} value={name} maxLength={NAME_LENGTH} onChange={(event) => setName(event.currentTarget.value)} testId="template-name" />
        </Box>
      </StepSection>
      <StepSection number={2} title={t('templates.upload.title')} description={t('templates.upload.description')}>
        <Stack space="space.200">
          <DropZone file={file} onFile={choose} />
          {catalog.status === 'error' && file ? (
            <InlineState tone="error" text={runErrorMessage(t, catalog.error)} action={<Button onClick={catalog.retry}>{t('errors.tryAgain')}</Button>} testId="catalog-error" />
          ) : (
            <InspectionStatus inspection={inspection} template={template} file={file} />
          )}
          <Inline space="space.100" shouldWrap>
            <Button iconBefore={DownloadIcon} onClick={downloadExample} testId="template-example">{t('templates.example')}</Button>
          </Inline>
          <TagsReference />
        </Stack>
      </StepSection>
      <StepSection number={3} title={t('templates.scope.title')} description={t('templates.scope.description')}>
        <ScopePicker scopes={scopes} projects={projects} value={scope} onChange={setScope} disabled={template !== null || savedId !== null} />
      </StepSection>
      {busy && file ? (
        <Stack space="space.100" testId="template-upload-progress">
          <Text color="color.text.subtle">{t('templates.upload.progress')}</Text>
          <ProgressBar value={progress} ariaLabel={t('templates.upload.progress')} testId="template-progress" />
        </Stack>
      ) : null}
      {failure ? (
        <SectionMessage appearance="error" testId="template-save-error">
          <Stack space="space.050">
            {failure.phase === 'upload' ? <Text>{t('templates.upload.failed')}</Text> : null}
            <Text>{runErrorMessage(t, failure.error)}</Text>
          </Stack>
        </SectionMessage>
      ) : null}
      <Box xcss={footerStyles}>
        <Flex gap="space.100" justifyContent="end" wrap="wrap">
          <Button appearance="subtle" onClick={onCancel} isDisabled={busy} testId="template-cancel">{t('templates.form.cancel')}</Button>
          <Button appearance="primary" onClick={submit} isDisabled={!canSave} isLoading={busy} testId="template-save">{t('templates.form.save')}</Button>
        </Flex>
      </Box>
    </Stack>
  );
}
