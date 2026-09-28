import { Stack } from '@atlaskit/primitives';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { PageIcon, PagesIcon, TreeIcon } from '../components/icons.js';
import { StepSection } from '../components/StepSection.jsx';
import { useT } from '../i18n/index.js';
import { PagePicker } from './PagePicker.jsx';

const SCOPES = [
  { value: 'space', icon: PagesIcon, accent: 'blue' },
  { value: 'branch', icon: TreeIcon, accent: 'teal' },
  { value: 'page', icon: PageIcon, accent: 'purple' },
];

/** Step 1: whole space, a page with its children, or one page; the last two show the page picker. */
export function ScopeStep({ number, form, client }) {
  const t = useT();
  const options = SCOPES.map((scope) => ({
    ...scope,
    title: t(`scope.${scope.value}.title`),
    description: t(`scope.${scope.value}.description`),
    testId: `scope-${scope.value}`,
  }));
  return (
    <StepSection number={number} title={t('step.scope.title')} description={t('step.scope.description')}>
      <Stack space="space.200">
        <ChoiceGroup
          label={t('step.scope.title')}
          value={form.target.kind}
          options={options}
          onChange={(kind) => form.setTarget({ kind })}
          columns="repeat(auto-fit, minmax(176px, 1fr))"
        />
        {form.target.kind !== 'space' ? (
          <PagePicker client={client} spaceKey={form.spaceKey} value={form.page} onChange={(page) => form.setTarget({ page })} />
        ) : null}
      </Stack>
    </StepSection>
  );
}
