import { Fieldset } from '@atlaskit/form';
import { Box, Stack, xcss } from '@atlaskit/primitives';
import { RadioGroup } from '@atlaskit/radio';
import Select from '@atlaskit/select';
import { useT } from '../i18n/index.js';

const selectStyles = xcss({ maxWidth: '360px', paddingInlineStart: 'space.400' });

/** Where a new template lives: the scope value for a personal one, the first managed project or the site. */
export function scopeValue(scope, scopes) {
  if (scope === 'project') return { scope, scopeId: scopes.projects[0] ?? '' };
  return { scope, scopeId: scope === 'site' ? 'site' : '' };
}

/**
 * Scope of a template: personal always; a project (from the projects the user administers) and the whole site only when allowed.
 * `value` is `{ scope, scopeId }`; `disabled` locks a saved template to its scope.
 */
export function ScopePicker({ scopes, projects, value, onChange, disabled = false }) {
  const t = useT();
  const options = [
    { scope: 'user', allowed: true },
    { scope: 'project', allowed: scopes.projects.length > 0 || value.scope === 'project' },
    { scope: 'site', allowed: scopes.site || value.scope === 'site' },
  ].filter((option) => option.allowed);
  const managed = new Set(scopes.projects);
  const names = new Map(projects.map((project) => [project.key, project.name]));
  const shown = disabled ? [value.scopeId] : scopes.projects;
  const projectOptions = shown.filter((key) => key !== '').map((key) => ({ value: key, label: names.has(key) ? `${key} · ${names.get(key)}` : key }));
  const current = projectOptions.find((option) => option.value === value.scopeId) ?? null;
  return (
    <Stack space="space.100">
      <Fieldset legend={t('templates.column.scope')}>
        <RadioGroup
          name="template-scope"
          value={value.scope}
          isDisabled={disabled}
          options={options.map(({ scope }) => ({ name: 'template-scope', value: scope, label: t(`templates.scope.option.${scope}`), testId: `scope-${scope}` }))}
          onChange={(event) => onChange(scopeValue(event.currentTarget.value, scopes))}
        />
      </Fieldset>
      {value.scope === 'project' ? (
        <Box xcss={selectStyles}>
          <Select
            inputId="template-scope-project"
            aria-label={t('templates.scope.project')}
            placeholder={t('templates.scope.projectPlaceholder')}
            options={projectOptions.filter((option) => managed.has(option.value) || disabled)}
            value={current}
            isDisabled={disabled}
            onChange={(option) => onChange({ scope: 'project', scopeId: option.value })}
          />
        </Box>
      ) : null}
    </Stack>
  );
}
