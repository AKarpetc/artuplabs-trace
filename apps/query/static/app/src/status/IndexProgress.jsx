import ProgressBar from '@atlaskit/progress-bar';
import { Stack, Text } from '@atlaskit/primitives';
import { formatNumber, useI18n } from '../i18n/index.js';

/** Progress of each index part: a bar and "N of M issues", or "Ready" once the part finished. */
export function IndexProgress({ progress }) {
  const { t, locale } = useI18n();
  const parts = Object.entries(progress ?? {});
  if (!parts.length) return null;
  return (
    <Stack space="space.200">
      {parts.map(([part, p]) => (
        <Stack key={part} space="space.075">
          <Text weight="medium">{t(`status.part.${part}`)}</Text>
          <ProgressBar value={p.total ? p.done / p.total : 0} ariaLabel={t(`status.part.${part}`)} />
          <Text color="color.text.subtle">{p.finishedAt ? t('status.indexReady') : t('status.indexProgress', { done: formatNumber(locale, p.done), total: formatNumber(locale, p.total) })}</Text>
        </Stack>
      ))}
    </Stack>
  );
}
