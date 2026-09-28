import { useId } from 'react';
import { Fieldset, Label } from '@atlaskit/form';
import { Box, Grid, Stack, Text, xcss } from '@atlaskit/primitives';
import { RadioGroup } from '@atlaskit/radio';
import Select from '@atlaskit/select';
import Textfield from '@atlaskit/textfield';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { BookIcon, GlobeIcon, LibraryIcon, MarkdownIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { useLocale, useT } from '../i18n/index.js';

const PRESET_CARDS = [
  { value: 'generic', icon: MarkdownIcon, accent: 'blue' },
  { value: 'hugo', icon: GlobeIcon, accent: 'orange', title: 'Hugo' },
  { value: 'docusaurus', icon: BookIcon, accent: 'purple', title: 'Docusaurus' },
  { value: 'mkdocs', icon: LibraryIcon, accent: 'teal', title: 'MkDocs' },
];
const ATTACHMENTS = ['all', 'referenced', 'none'];

const unitStyles = xcss({ paddingInlineEnd: 'space.100', color: 'color.text.subtle', whiteSpace: 'nowrap' });
const sizeStyles = xcss({ maxWidth: '200px' });

function unitLabel(locale) {
  const parts = new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', unitDisplay: 'short' }).formatToParts(1);
  return parts.find((part) => part.type === 'unit')?.value ?? '';
}

function Choice({ legend, name, value, options, onChange, help }) {
  return (
    <Fieldset legend={legend}>
      <Stack space="space.050">
        <RadioGroup name={name} value={value} options={options} onChange={(event) => onChange(event.currentTarget.value)} />
        {help ? <Text size="small" color="color.text.subtle">{help}</Text> : null}
      </Stack>
    </Fieldset>
  );
}

/** Step 2: preset cards, page order, file names and attachment options. */
export function FormatStep({ number, form }) {
  const t = useT();
  const locale = useLocale();
  const attachmentsId = useId();
  const sizeId = useId();
  const { options, setOption } = form;
  const presets = PRESET_CARDS.map((card) => ({
    ...card,
    title: card.title ?? t(`preset.${card.value}.title`),
    description: t(`preset.${card.value}.description`),
    testId: `preset-${card.value}`,
  }));
  const attachmentOptions = ATTACHMENTS.map((value) => ({ value, label: t(`attachments.${value}`) }));
  const onSize = (event) => {
    const text = event.currentTarget.value;
    setOption('maxAttachmentMb', text === '' ? '' : Math.max(1, Math.round(Number(text)) || 1));
  };
  return (
    <StepSection number={number} title={t('step.format.title')} description={t('step.format.description')}>
      <Stack space="space.300">
        <ChoiceGroup label={t('step.format.title')} value={options.preset} options={presets} onChange={(preset) => setOption('preset', preset)} />
        <Grid gap="space.300" templateColumns="repeat(auto-fit, minmax(260px, 1fr))">
          <Choice
            legend={t('order.label')}
            name="ordering"
            value={options.ordering}
            onChange={(value) => setOption('ordering', value)}
            options={[{ name: 'ordering', value: 'weight', label: t('order.weight') }, { name: 'ordering', value: 'prefix', label: t('order.prefix') }]}
          />
          <Choice
            legend={t('fileNames.label')}
            name="fileNames"
            value={options.fileNames}
            onChange={(value) => setOption('fileNames', value)}
            options={[{ name: 'fileNames', value: 'ascii', label: t('fileNames.ascii') }, { name: 'fileNames', value: 'unicode', label: t('fileNames.unicode') }]}
            help={t('fileNames.help')}
          />
          <Stack space="space.050">
            <Label htmlFor={attachmentsId}>{t('attachments.label')}</Label>
            <Select
              inputId={attachmentsId}
              options={attachmentOptions}
              value={attachmentOptions.find((option) => option.value === options.attachments)}
              onChange={(option) => option && setOption('attachments', option.value)}
              isSearchable={false}
            />
          </Stack>
          <Stack space="space.050">
            <Label htmlFor={sizeId}>{t('attachments.maxSize')}</Label>
            <Box xcss={sizeStyles}>
              <Textfield
                id={sizeId}
                type="number"
                min={1}
                inputMode="numeric"
                value={options.maxAttachmentMb}
                onChange={onSize}
                isDisabled={options.attachments === 'none'}
                elemAfterInput={<Box as="span" xcss={unitStyles}>{unitLabel(locale)}</Box>}
              />
            </Box>
          </Stack>
        </Grid>
      </Stack>
    </StepSection>
  );
}
