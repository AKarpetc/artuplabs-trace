import ProgressBar from '@atlaskit/progress-bar';
import { Stack, Text } from '@atlaskit/primitives';
import { formatNumber, useI18n } from '../i18n/index.js';

/** Share of a part read, between 0 and 1: a partial reindex can count more issues done than the total it started with. */
const share = (p) => (p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0);

/** Progress of each index part: a bar and "N of M issues" (never more than M), or "Ready" once the part finished. */
export function IndexProgress({ progress }) {
  const { t, locale } = useI18n();
  const parts = Object.entries(progress ?? {});
  if (!parts.length) return null;
  return (
    <Stack space="space.200">
      {parts.map(([part, p]) => (
        <Stack key={part} space="space.075">
          <Text weight="medium">{t(`status.part.${part}`)}</Text>
          <ProgressBar value={share(p)} ariaLabel={t(`status.part.${part}`)} />
          <Text color="color.text.subtle">{p.finishedAt ? t('status.indexReady') : t('status.indexProgress', { done: formatNumber(locale, Math.min(p.done, p.total)), total: formatNumber(locale, p.total) })}</Text>
        </Stack>
      ))}
    </Stack>
  );
}
