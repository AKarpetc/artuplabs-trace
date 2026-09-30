import { Fieldset } from '@atlaskit/form';
import { Stack } from '@atlaskit/primitives';
import { RadioGroup } from '@atlaskit/radio';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { FileIcon, PageIcon, TableIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { useT } from '../i18n/index.js';
import { FORMATS } from './useWizardForm.js';

const LOOK = {
  xlsx: { icon: TableIcon, accent: 'teal' },
  docx: { icon: PageIcon, accent: 'blue' },
  pdf: { icon: FileIcon, accent: 'orange' },
};
const PAPERS = ['A4', 'LETTER'];

/** Paper size radios (A4 / Letter) for Word and PDF. */
export function PaperChoice({ value, onChange }) {
  const t = useT();
  return (
    <Fieldset legend={t('format.paper')}>
      <RadioGroup
        name="paper"
        value={value}
        options={PAPERS.map((paper) => ({ name: 'paper', value: paper, label: t(`format.paper.${paper}`), testId: `paper-${paper}` }))}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Fieldset>
  );
}

/** Format step: Excel, Word and PDF cards; Word and PDF add the paper size. */
export function FormatStep({ number, form }) {
  const t = useT();
  const { format, paper } = form.state;
  const options = FORMATS.map((value) => ({
    value, ...LOOK[value], title: t(`format.${value}.title`), description: t(`format.${value}.description`), testId: `format-${value}`,
  }));
  return (
    <StepSection number={number} title={t('format.title')} description={t('format.description')}>
      <Stack space="space.200">
        <ChoiceGroup label={t('format.title')} value={format} options={options} onChange={form.setFormat} columns="repeat(auto-fit, minmax(200px, 1fr))" />
        {format === 'xlsx' ? null : <PaperChoice value={paper} onChange={form.setPaper} />}
      </Stack>
    </StepSection>
  );
}
