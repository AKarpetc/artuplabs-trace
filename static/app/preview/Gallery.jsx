import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import BookIcon from '@atlaskit/icon/core/book-with-bookmark';
import DownloadIcon from '@atlaskit/icon/core/download';
import GlobeIcon from '@atlaskit/icon/core/globe';
import LibraryIcon from '@atlaskit/icon/core/library';
import MarkdownIcon from '@atlaskit/icon/core/markdown';
import PagesIcon from '@atlaskit/icon/core/pages';
import StopwatchIcon from '@atlaskit/icon/core/stopwatch';
import TreeIcon from '@atlaskit/icon/core/tree';
import WarningIcon from '@atlaskit/icon/core/warning';
import { Box, Grid, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { formatNumber, useLocale, useT } from '../src/i18n/index.js';
import { AppHeader } from '../src/components/AppHeader.jsx';
import { ChoiceCard } from '../src/components/ChoiceCard.jsx';
import { FileTree } from '../src/components/FileTree.jsx';
import { PageLayout } from '../src/components/PageLayout.jsx';
import { StatTile } from '../src/components/StatTile.jsx';
import { StepSection } from '../src/components/StepSection.jsx';
import { AppIcon } from '../src/illustrations/AppIcon.jsx';
import { EmptyIllustration } from '../src/illustrations/EmptyIllustration.jsx';
import { ExportIllustration } from '../src/illustrations/ExportIllustration.jsx';
import { LockIllustration } from '../src/illustrations/LockIllustration.jsx';
import { SuccessIllustration } from '../src/illustrations/SuccessIllustration.jsx';

/**
 * Developer gallery of the shared components and illustrations (`?entry=gallery`).
 * Demo copy is English on purpose: it is not shipped and only exercises layout and wrapping.
 */

const pageStyles = xcss({ minHeight: '100vh', backgroundColor: 'elevation.surface', padding: 'space.300' });
const cardStyles = xcss({ padding: 'space.300', borderRadius: 'radius.large', backgroundColor: 'elevation.surface.raised', boxShadow: 'elevation.shadow.raised' });
const captionStyles = xcss({ textAlign: 'center' });

const SCOPES = [
  { value: 'space', icon: PagesIcon, accent: 'blue', title: 'Whole space', description: 'Every page of Product Documentation, with attachments and the page hierarchy as folders.' },
  { value: 'tree', icon: TreeIcon, accent: 'teal', title: 'One page and its children', description: 'Pick a page; everything below it goes into the zip. Unterseitenhierarchie wird als Ordnerstruktur übernommen, damit lange Übersetzungen umbrechen.' },
];

const PRESETS = [
  { value: 'gfm', icon: MarkdownIcon, accent: 'blue', title: 'GitHub Markdown', description: 'Plain GFM for READMEs and wikis.', badge: 'Recommended' },
  { value: 'docusaurus', icon: BookIcon, accent: 'purple', title: 'Docusaurus', description: 'Front-matter with sidebar position and slugs.' },
  { value: 'mkdocs', icon: LibraryIcon, accent: 'teal', title: 'MkDocs', description: 'index.md per folder, admonitions for panels.' },
  { value: 'hugo', icon: GlobeIcon, accent: 'orange', title: 'Hugo', description: '_index.md sections and TOML-free YAML front-matter.' },
];

const PATHS = [
  'product-documentation/index.md',
  'product-documentation/getting-started/index.md',
  'product-documentation/getting-started/installation.md',
  'product-documentation/getting-started/installation.assets/setup-wizard.png',
  'product-documentation/getting-started/configuration.md',
  'product-documentation/arkhitektura-sistemy/index.md',
  'product-documentation/arkhitektura-sistemy/obzor-komponentov.md',
  'product-documentation/arkhitektura-sistemy/obzor-komponentov.assets/architecture.svg',
  'product-documentation/api-リファレンス/エンドポイント一覧.md',
  'product-documentation/api-リファレンス/エンドポイント一覧.assets/openapi-spec.pdf',
  'product-documentation/reference/a-deliberately-long-page-title-that-keeps-going-to-check-wrapping-in-every-view-of-the-export-studio-including-the-tree-preview.md',
  'product-documentation/reference/api.md',
  'product-documentation/reference/api-2.md',
  'product-documentation/reference/cafe.md',
  'product-documentation/reference/cafe-2.md',
  'archive/index.md',
  'archive/old-roadmap-2024.md',
  'export-manifest.json',
];

const ILLUSTRATIONS = [
  ['ExportIllustration', ExportIllustration],
  ['EmptyIllustration', EmptyIllustration],
  ['LockIllustration', LockIllustration],
  ['SuccessIllustration', SuccessIllustration],
];

/** Radio group of choice cards bound to local state. */
function ChoiceGroup({ items, columns, disabledValue }) {
  const [value, setValue] = useState(items[0].value);
  return (
    <Grid role="radiogroup" gap="space.150" templateColumns={columns}>
      {items.map((item) => (
        <ChoiceCard
          key={item.value}
          selected={value === item.value}
          onSelect={() => setValue(item.value)}
          icon={item.icon}
          accent={item.accent}
          title={item.title}
          description={item.description}
          badge={item.badge}
          disabled={item.value === disabledValue}
          testId={`gallery-choice-${item.value}`}
        />
      ))}
    </Grid>
  );
}

function Main({ locale }) {
  return (
    <Stack space="space.400">
      <StepSection number={1} title="Choose what to export" description="The whole space or one branch of the page tree.">
        <ChoiceGroup items={SCOPES} columns="repeat(auto-fit, minmax(240px, 1fr))" />
      </StepSection>
      <StepSection number={2} title="Choose a format" description="Presets shape file names, front-matter and admonitions. Disabled card below shows the disabled state.">
        <ChoiceGroup items={PRESETS} columns="repeat(auto-fit, minmax(240px, 1fr))" disabledValue="hugo" />
      </StepSection>
      <StepSection number={3} title="Result" description="Stat tiles in every tone.">
        <Grid gap="space.200" templateColumns="repeat(auto-fit, minmax(150px, 1fr))">
          <StatTile label="Pages" value={formatNumber(locale, 60)} tone="neutral" icon={PagesIcon} />
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
      <Stack space="space.200">
        <Heading size="small">Preview of the zip</Heading>
        <FileTree paths={PATHS} />
      </Stack>
    </Box>
  );
}

/** Gallery page: header, steps with choice cards and stat tiles, file tree aside, illustrations. */
export function Gallery() {
  const t = useT();
  const locale = useLocale();
  return (
    <Box xcss={pageStyles}>
      <Stack space="space.400">
        <AppHeader
          subtitle={t('app.tagline')}
          spaceName="Product Documentation"
          actions={(
            <>
              <Button appearance="subtle">Settings</Button>
              <Button appearance="primary">Export</Button>
            </>
          )}
        />
        <PageLayout main={<Main locale={locale} />} aside={<Aside />} />
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
            <Inline space="space.200" alignBlock="center">
              <LockIllustration size={96} />
              <Stack space="space.100">
                <Heading size="small">{t('unlicensed.title')}</Heading>
                <Text color="color.text.subtle">{t('unlicensed.body')}</Text>
              </Stack>
            </Inline>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
