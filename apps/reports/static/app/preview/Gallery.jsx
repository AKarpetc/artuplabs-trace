import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import { Box, Grid, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { formatNumber, useLocale, useT } from '../src/i18n/index.js';
import { AccessGate } from '../src/app/AccessGate.jsx';
import { AppHeader } from '../src/components/AppHeader.jsx';
import { ChoiceGroup } from '../src/components/ChoiceCard.jsx';
import { DownloadIcon, FileIcon, FilterIcon, PageIcon, StopwatchIcon, TableIcon, WarningIcon } from '../src/components/icons.js';
import { PageLayout } from '../src/components/PageLayout.jsx';
import { StatTile } from '../src/components/StatTile.jsx';
import { StepSection } from '../src/components/StepSection.jsx';
import { AppIcon } from '../src/illustrations/AppIcon.jsx';
import { EmptyIllustration } from '../src/illustrations/EmptyIllustration.jsx';
import { LockIllustration } from '../src/illustrations/LockIllustration.jsx';
import { ReportIllustration } from '../src/illustrations/ReportIllustration.jsx';
import { SuccessIllustration } from '../src/illustrations/SuccessIllustration.jsx';
import { ActionScreen } from './ActionScreen.jsx';
import { GlobalScreen } from './GlobalScreen.jsx';
import { TemplatesScreen } from './TemplatesScreen.jsx';
import { WizardScreen } from './WizardScreen.jsx';

/**
 * Developer gallery of the shared components, illustrations and access states (`?screen=gallery`).
 * Demo copy is English on purpose: it is not shipped and only exercises layout and wrapping.
 */

const pageStyles = xcss({ minHeight: '100vh', backgroundColor: 'elevation.surface', padding: 'space.300' });
const cardStyles = xcss({ padding: 'space.300', borderRadius: 'radius.large', backgroundColor: 'elevation.surface.raised', boxShadow: 'elevation.shadow.raised' });
const captionStyles = xcss({ textAlign: 'center' });

const FORMATS = [
  { value: 'xlsx', icon: TableIcon, accent: 'teal', title: 'Excel', description: 'One row per issue, columns you pick, grouping and a summary sheet.', badge: 'Recommended' },
  { value: 'docx', icon: PageIcon, accent: 'blue', title: 'Word', description: 'Built-in layouts or your own template with placeholders. Unterseiten und lange Übersetzungen brechen um.' },
  { value: 'pdf', icon: FileIcon, accent: 'orange', title: 'PDF', description: 'Print-ready pages with images, in any language.' },
  { value: 'csv', icon: FilterIcon, accent: 'purple', title: 'Disabled option', description: 'Shows the disabled state of a card.' },
];

const ILLUSTRATIONS = [
  ['ReportIllustration', ReportIllustration],
  ['EmptyIllustration', EmptyIllustration],
  ['LockIllustration', LockIllustration],
  ['SuccessIllustration', SuccessIllustration],
];

function Main({ locale }) {
  const [format, setFormat] = useState('xlsx');
  const options = FORMATS.map((item) => ({ ...item, disabled: item.value === 'csv', testId: `gallery-choice-${item.value}` }));
  return (
    <Stack space="space.400">
      <StepSection number={1} title="Choose a format" description="Choice cards are radios: arrows move, Space and Enter select.">
        <ChoiceGroup label="Choose a format" value={format} options={options} onChange={setFormat} columns="repeat(auto-fit, minmax(240px, 1fr))" />
      </StepSection>
      <StepSection number={2} title="Result" description="Stat tiles in every tone.">
        <Grid gap="space.200" templateColumns="repeat(auto-fit, minmax(150px, 1fr))">
          <StatTile label="Issues" value={formatNumber(locale, 30)} tone="neutral" icon={PageIcon} />
          <StatTile label="Attachments" value={formatNumber(locale, 5)} tone="success" icon={DownloadIcon} />
          <StatTile label="Warnings" value={formatNumber(locale, 7)} tone="warning" icon={WarningIcon} />
          <StatTile label="Duration" value="1 min 12 s" tone="danger" icon={StopwatchIcon} />
        </Grid>
      </StepSection>
    </Stack>
  );
}

function Aside() {
  return (
    <Box xcss={cardStyles}>
      <Stack space="space.200" alignInline="center">
        <ReportIllustration size={160} />
        <Heading size="small">Your report</Heading>
        <Text color="color.text.subtle">The aside is a raised card that stays in view on wide screens.</Text>
      </Stack>
    </Box>
  );
}

function Illustrations() {
  return (
    <Box xcss={cardStyles}>
      <Stack space="space.300">
        <Heading size="small">Illustrations</Heading>
        <Inline space="space.400" shouldWrap alignBlock="end">
          {ILLUSTRATIONS.map(([name, Illustration]) => (
            <Stack key={name} space="space.100" alignInline="center" xcss={captionStyles}>
              <Illustration />
              <Text size="small" color="color.text.subtle">{name}</Text>
            </Stack>
          ))}
          <Stack space="space.100" alignInline="center" xcss={captionStyles}>
            <Inline space="space.200" alignBlock="end">
              <AppIcon size={16} />
              <AppIcon size={24} />
              <AppIcon size={32} />
              <AppIcon size={48} />
            </Inline>
            <Text size="small" color="color.text.subtle">AppIcon</Text>
          </Stack>
        </Inline>
      </Stack>
    </Box>
  );
}

/** Gallery page behind the access gate: header, choice cards and stat tiles, aside and illustrations. */
export function Gallery() {
  const t = useT();
  const locale = useLocale();
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <Stack space="space.400">
          <AppHeader
            subtitle={t('app.tagline')}
            scopeName="RPT"
            actions={(
              <>
                <Button appearance="subtle">Templates</Button>
                <Button appearance="primary">Export</Button>
              </>
            )}
          />
          <PageLayout main={<Main locale={locale} />} aside={<Aside />} />
          <Illustrations />
        </Stack>
      </AccessGate>
    </Box>
  );
}

/** Screen components by `?screen=` name; later screens are added here. */
export const SCREEN_COMPONENTS = { gallery: Gallery, wizard: WizardScreen, templates: TemplatesScreen, global: GlobalScreen, action: ActionScreen };
