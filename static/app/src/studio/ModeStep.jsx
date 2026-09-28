import { useState } from 'react';
import SectionMessage from '@atlaskit/section-message';
import { token } from '@atlaskit/tokens';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { DownloadIcon, RefreshIcon, UploadIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { formatBytes, useLocale, useT } from '../i18n/index.js';
import { MAX_PREVIOUS_BYTES } from './useExportForm.js';

const MODES = [
  { value: 'full', icon: DownloadIcon, accent: 'blue' },
  { value: 'update', icon: RefreshIcon, accent: 'teal' },
];

const zoneStyles = xcss({
  display: 'block',
  position: 'relative',
  padding: 'space.200',
  borderWidth: 'border.width.selected',
  borderStyle: 'dashed',
  borderColor: 'color.border',
  borderRadius: 'radius.large',
  cursor: 'pointer',
  ':hover': { backgroundColor: 'color.background.neutral.subtle.hovered' },
  ':focus-within': {
    outlineWidth: 'border.width.focused',
    outlineStyle: 'solid',
    outlineColor: 'color.border.focused',
    outlineOffset: 'space.025',
  },
});
const draggingStyles = xcss({ borderColor: 'color.border.selected', backgroundColor: 'color.background.selected' });
const tileStyles = xcss({
  width: '40px',
  height: '40px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'radius.medium',
  backgroundColor: 'color.background.neutral',
});
const textStyles = xcss({ minWidth: '0', flexGrow: 1, overflowWrap: 'anywhere' });
const fileStyles = xcss({ fontFamily: 'font.family.code', font: 'font.body.small', color: 'color.text.subtle', overflowWrap: 'anywhere' });
const hiddenInput = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** Dashed drop target over a visually hidden file input; click, keyboard or drag a zip / manifest onto it. */
function DropZone({ fileName, onFile }) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const over = (event) => {
    event.preventDefault();
    setDragging(true);
  };
  const drop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  };
  return (
    <Box as="label" testId="drop-zone" xcss={[zoneStyles, dragging && draggingStyles]} onDragEnter={over} onDragOver={over} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <input
        type="file"
        accept=".zip,.json,application/zip,application/json"
        style={hiddenInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
      <Inline space="space.150" alignBlock="center">
        <Box xcss={tileStyles}>
          <UploadIcon label="" color={token(dragging ? 'color.icon.selected' : 'color.icon.subtle')} />
        </Box>
        <Stack space="space.025" xcss={textStyles}>
          <Text weight="medium">{t('drop.title')}</Text>
          {fileName ? <Box xcss={fileStyles}>{fileName}</Box> : <Text size="small" color="color.text.subtle">{t('drop.hint')}</Text>}
        </Stack>
      </Inline>
    </Box>
  );
}

function Status({ form }) {
  const t = useT();
  const locale = useLocale();
  const { previous, modeChoice, fullReason } = form;
  if (!previous) return null;
  if (previous.error) return <SectionMessage appearance="error">{t(`drop.error.${previous.error}`, { size: formatBytes(locale, MAX_PREVIOUS_BYTES) })}</SectionMessage>;
  if (modeChoice !== 'update') return null;
  if (fullReason) return <SectionMessage appearance="warning">{t(`drop.full.${fullReason}`)}</SectionMessage>;
  return <SectionMessage appearance="success">{t('drop.loaded', { count: previous.manifest.pages.length })}</SectionMessage>;
}

/** Full or update cards, the drop zone for the previous zip or manifest, and what the dropped file means. */
export function ModeFields({ form }) {
  const t = useT();
  const options = MODES.map((mode) => ({
    ...mode,
    title: t(`mode.${mode.value}.title`),
    description: t(`mode.${mode.value}.description`),
    testId: `mode-${mode.value}`,
  }));
  return (
    <Stack space="space.200">
      <ChoiceGroup label={t('step.mode.title')} value={form.modeChoice} options={options} onChange={form.setModeChoice} />
      <DropZone fileName={form.previous?.fileName} onFile={form.setPreviousFile} />
      <Status form={form} />
    </Stack>
  );
}

/** Step 3: full or update export, with the drop zone for the previous zip or manifest and what it means. */
export function ModeStep({ number, form }) {
  const t = useT();
  return (
    <StepSection number={number} title={t('step.mode.title')} description={t('step.mode.description')}>
      <ModeFields form={form} />
    </StepSection>
  );
}
