import { useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Heading from '@atlaskit/heading';
import Textfield from '@atlaskit/textfield';
import { Stack } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { FunctionCard } from './FunctionCard.jsx';
import { MigrationNote } from './MigrationNote.jsx';

const GROUPS = ['query', 'site', 'board', 'sprint', 'comment', 'attachment', 'fields'];

/** Searchable reference of the shipped functions, by group. */
export function FunctionReference({ functions }) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return functions.filter((f) => !q || f.name.toLowerCase().includes(q) || t(`fn.${f.name}`).toLowerCase().includes(q));
  }, [functions, filter, t]);
  return (
    <Stack space="space.400">
      <MigrationNote />
      <Textfield aria-label={t('reference.search')} placeholder={t('reference.search')} value={filter} onChange={(e) => setFilter(e.target.value)} testId="reference-search" />
      {visible.length === 0 ? (
        <EmptyState
          header={t('reference.none')}
          renderImage={() => <EmptyIllustration size={120} />}
          primaryAction={<Button onClick={() => setFilter('')}>{t('reference.clear')}</Button>}
          headingLevel={2}
        />
      ) : null}
      {GROUPS.map((group) => {
        const list = visible.filter((f) => f.group === group);
        if (!list.length) return null;
        return (
          <Stack key={group} space="space.200">
            <Heading size="medium" as="h2">{t(`group.${group}`)}</Heading>
            {list.map((f) => <FunctionCard key={f.name} fn={f} />)}
          </Stack>
        );
      })}
    </Stack>
  );
}
