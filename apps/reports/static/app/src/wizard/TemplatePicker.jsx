import { useState } from 'react';
import Heading from '@atlaskit/heading';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Skeleton from '@atlaskit/skeleton';
import { token } from '@atlaskit/tokens';
import { Box, Grid, Stack, Text, xcss } from '@atlaskit/primitives';
import { BUILTINS } from '../core/builtins.js';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { FileIcon, FilesIcon, PageIcon, TableIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { useLocale, useT } from '../i18n/index.js';
import { TEMPLATE_GROUPS, templatesFor } from './useTemplates.js';

const WIDE = '@media (min-width: 900px)';
const CARD_COLUMNS = 'repeat(auto-fit, minmax(220px, 1fr))';

const splitStyles = xcss({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 'space.300',
  alignItems: 'start',
  [WIDE]: { gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' },
});
const thumbFrameStyles = xcss({ minWidth: '0', maxWidth: '240px', width: '100%', [WIDE]: { maxWidth: '360px' } });
const sheetStyles = xcss({
  aspectRatio: '1 / 1.3',
  boxSizing: 'border-box',
  padding: 'space.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  overflow: 'hidden',
});
const barStyles = xcss({ height: '8px', borderRadius: 'radius.small', backgroundColor: 'color.background.neutral' });
const titleBarStyles = xcss({ height: '12px', backgroundColor: 'color.background.accent.blue.subtle' });
const headBarStyles = xcss({ backgroundColor: 'color.background.accent.blue.subtler' });
const imageStyle = {
  display: 'block',
  boxSizing: 'border-box',
  width: '100%',
  borderRadius: token('radius.large'),
  border: `${token('border.width')} solid ${token('color.border')}`,
};

const ICON = { xlsx: TableIcon, docx: PageIcon, pdf: FileIcon };
const ACCENT = { xlsx: 'teal', docx: 'blue', pdf: 'orange' };

const bar = (width, extra) => ({ width, extra });
const SKETCH = {
  single: [bar('70%', titleBarStyles), ...['40%', '55%', '35%', '50%', '45%'].map((w) => bar(w)), bar('30%', headBarStyles), bar('95%'), bar('90%'), bar('80%')],
  list: [bar('60%', titleBarStyles), bar('100%', headBarStyles), ...Array.from({ length: 9 }, () => bar('100%'))],
  sprint: [bar('50%', titleBarStyles), bar('25%'), bar('100%', headBarStyles), bar('100%'), bar('100%'), bar('35%', headBarStyles), bar('100%'), bar('100%'), bar('100%')],
  release: [bar('55%', titleBarStyles), bar('30%', headBarStyles), bar('85%'), bar('75%'), bar('80%'), bar('30%', headBarStyles), bar('70%'), bar('85%')],
  docx: [bar('60%', titleBarStyles), bar('90%'), bar('95%'), bar('85%'), bar('100%', headBarStyles), bar('100%'), bar('100%'), bar('70%')],
};

function Sketch({ kind }) {
  return (
    <Box xcss={sheetStyles} testId="template-sketch">
      <Stack space="space.150">
        {(SKETCH[kind] ?? SKETCH.docx).map((line, index) => (
          <Box key={index} xcss={[barStyles, line.extra]} style={{ width: line.width }} />
        ))}
      </Stack>
    </Box>
  );
}

/** Picture of a built-in Word/PDF layout (thumbs/<layout>.png, shared by both formats); a drawn sketch of the layout when it does not load. */
export function TemplateThumbnail({ template }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const kind = template.kind === 'layout' ? template.layout : 'docx';
  const name = templateTitle(t, template);
  return (
    <Stack space="space.100" xcss={thumbFrameStyles} testId="template-thumbnail">
      {template.builtin && !failed
        ? <img src={`thumbs/${template.layout}.png`} alt={t('template.thumbnail', { name })} style={imageStyle} onError={() => setFailed(true)} />
        : <Sketch kind={kind} />}
      <Text size="small" color="color.text.subtle" align="center">{name}</Text>
    </Stack>
  );
}

/** Name of a template: translated for built-ins, as stored for custom ones. */
export function templateTitle(t, template) {
  if (!template.builtin) return template.name;
  return template.kind === 'layout' ? t(`template.layout.${template.layout}.title`) : t(`template.${template.id}.title`);
}

function builtinDescription(t, template) {
  return template.kind === 'layout' ? t(`template.layout.${template.layout}.description`) : t(`template.${template.id}.description`);
}

function customDescription(t, template) {
  const what = template.kind === 'columns'
    ? t('template.custom.columns', { count: template.columns?.length ?? 0 })
    : template.kind === 'layout' ? t(`template.layout.${template.layout}.title`) : t('template.custom.docx');
  return template.scope === 'project' ? `${template.scopeId} · ${what}` : what;
}

function Group({ title, templates, selectedId, format, onChoose, describe, testId }) {
  const t = useT();
  const options = templates.map((template) => ({
    value: template.id,
    title: templateTitle(t, template),
    description: describe(t, template),
    icon: template.kind === 'docx' ? FilesIcon : ICON[format],
    accent: ACCENT[format],
    testId: `template-${template.id}`,
  }));
  const byId = new Map(templates.map((template) => [template.id, template]));
  return (
    <Stack space="space.100" testId={testId}>
      <Heading size="xxsmall" as="h3">{title}</Heading>
      <ChoiceGroup label={title} value={selectedId} options={options} onChange={(id) => onChoose(byId.get(id))} columns={CARD_COLUMNS} />
    </Stack>
  );
}

function StoredGroups({ templates, format, selectedId, onChoose }) {
  const t = useT();
  const locale = useLocale();
  if (templates.status === 'loading') {
    return (
      <Stack space="space.100" testId="templates-loading">
        <Skeleton width="160px" height="16px" borderRadius={token('radius.small')} />
        <Grid gap="space.150" templateColumns={CARD_COLUMNS}>
          <Skeleton width="100%" height="72px" borderRadius={token('radius.large')} />
          <Skeleton width="100%" height="72px" borderRadius={token('radius.large')} />
        </Grid>
      </Stack>
    );
  }
  if (templates.status === 'error') {
    return (
      <SectionMessage appearance="warning" actions={<SectionMessageAction onClick={templates.retry}>{t('errors.tryAgain')}</SectionMessageAction>} testId="templates-error">
        <Text>{t('template.loadError')}</Text>
      </SectionMessage>
    );
  }
  const groups = templatesFor(templates.groups, format, locale);
  return TEMPLATE_GROUPS.filter((group) => groups[group].length > 0).map((group) => (
    <Group
      key={group}
      title={t(`template.group.${group}`)}
      templates={groups[group]}
      selectedId={selectedId}
      format={format}
      onChoose={onChoose}
      describe={customDescription}
      testId={`templates-${group}`}
    />
  ));
}

/** Template step: built-in, personal, project and site templates of the chosen format; Word and PDF show the layout's picture. */
export function TemplatePicker({ number, form, templates }) {
  const t = useT();
  const { format, selected } = form.state;
  const builtins = BUILTINS.filter((template) => template.format === format);
  const list = (
    <Stack space="space.300">
      <Group
        title={t('template.group.builtin')}
        templates={builtins}
        selectedId={selected.id}
        format={format}
        onChoose={form.chooseTemplate}
        describe={builtinDescription}
        testId="templates-builtin"
      />
      <StoredGroups templates={templates} format={format} selectedId={selected.id} onChoose={form.chooseTemplate} />
    </Stack>
  );
  return (
    <StepSection number={number} title={t('template.title')} description={t(`template.description.${format}`)}>
      {format === 'xlsx' ? list : (
        <Box xcss={splitStyles}>
          {list}
          <TemplateThumbnail template={selected} />
        </Box>
      )}
    </StepSection>
  );
}
