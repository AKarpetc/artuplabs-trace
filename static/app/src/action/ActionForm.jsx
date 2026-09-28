import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import Skeleton from '@atlaskit/skeleton';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { ChevronDownIcon, ChevronRightIcon, DownloadIcon, PageIcon, TreeIcon } from '../components/icons.js';
import { useT } from '../i18n/index.js';
import { FormatOptions, PresetChoice } from '../studio/FormatStep.jsx';
import { ModeFields } from '../studio/ModeStep.jsx';
import { OutputPreview } from '../studio/OutputPreview.jsx';
import { usePreview } from '../studio/usePreview.js';

const TREE_LIMIT = 8;

const presetGridStyles = xcss({
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  '@media (min-width: 40rem)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
});

const moreStyles = xcss({
  padding: 'space.200',
  borderRadius: 'radius.large',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});
const fillStyles = xcss({ flexGrow: 1 });
const footerStyles = xcss({
  marginBlockStart: 'auto',
  position: 'sticky',
  bottom: 'space.0',
  zIndex: 'card',
  marginInline: 'space.negative.300',
  marginBlockEnd: 'space.negative.300',
  paddingInline: 'space.300',
  paddingBlock: 'space.200',
  backgroundColor: 'elevation.surface',
  borderBlockStartWidth: 'border.width',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'color.border',
});

function scopeOptions(t, subpages) {
  const loading = subpages === undefined;
  let branchTitle = t('action.withChildrenUnknown');
  if (loading) branchTitle = <Skeleton width="180px" height="16px" isShimmering testId="action-count-skeleton" />;
  else if (typeof subpages === 'number' && subpages > 0) branchTitle = t('action.withChildren', { count: subpages });
  return [
    { value: 'page', icon: PageIcon, accent: 'purple', title: t('action.thisPage'), description: t('scope.page.description'), testId: 'action-page' },
    {
      value: 'branch',
      icon: TreeIcon,
      accent: 'teal',
      title: branchTitle,
      description: subpages === 0 ? t('action.noChildren') : t('scope.branch.description'),
      disabled: subpages === 0,
      testId: 'action-branch',
    },
  ];
}

function exportLabel(t, form, subpages) {
  if (form.target.kind === 'page') return t('studio.exportButton', { count: 1 });
  return typeof subpages === 'number' ? t('studio.exportButton', { count: subpages + 1 }) : t('studio.exportButtonUnknown');
}

function MoreOptions({ form }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Stack space="space.150">
      <Box>
        <Button appearance="subtle" iconBefore={open ? ChevronDownIcon : ChevronRightIcon} onClick={() => setOpen(!open)} aria-expanded={open} testId="action-more">
          {t('action.moreOptions')}
        </Button>
      </Box>
      {open ? (
        <Box xcss={moreStyles}>
          <Stack space="space.300">
            <FormatOptions form={form} />
            <Stack space="space.150">
              <Heading size="xxsmall" as="h3">{t('step.mode.title')}</Heading>
              <ModeFields form={form} />
            </Stack>
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

/**
 * Page action form: this page or the page with its subpages (`subpages` is undefined while counted, null when unknown),
 * a compact preset row, collapsed "More options", a small file tree, and a sticky Cancel / Export footer.
 */
export function ActionForm({ form, subpages, createClient, cancelled, onStart, onCancel }) {
  const t = useT();
  const preview = usePreview({ createClient, target: form.target, options: form.options, names: form.names, siteUrl: form.form.siteUrl });
  return (
    <Stack space="space.300" xcss={fillStyles}>
      {cancelled ? <SectionMessage appearance="information"><Text>{t('run.cancelled')}</Text></SectionMessage> : null}
      <Stack as="section" space="space.150">
        <Heading size="xsmall" as="h2">{t('step.scope.title')}</Heading>
        <ChoiceGroup
          label={t('step.scope.title')}
          value={form.target.kind}
          options={scopeOptions(t, subpages)}
          onChange={(kind) => form.setTarget({ kind })}
          columns="repeat(auto-fit, minmax(220px, 1fr))"
        />
      </Stack>
      <Stack as="section" space="space.150">
        <Heading size="xsmall" as="h2">{t('step.format.title')}</Heading>
        <PresetChoice form={form} compact gridStyles={presetGridStyles} />
      </Stack>
      <MoreOptions form={form} />
      <OutputPreview preview={preview} limit={TREE_LIMIT} compact />
      <Box xcss={footerStyles}>
        <Flex gap="space.100" justifyContent="end" wrap="wrap">
          <Button appearance="subtle" onClick={onCancel} testId="action-cancel">{t('run.cancel')}</Button>
          <Button appearance="primary" iconAfter={DownloadIcon} isDisabled={!form.ready} onClick={() => onStart(form.form)} testId="action-export">
            {exportLabel(t, form, subpages)}
          </Button>
        </Flex>
      </Box>
    </Stack>
  );
}
