import { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import ProgressBar from '@atlaskit/progress-bar';
import { ProgressTracker } from '@atlaskit/progress-tracker';
import SectionMessage from '@atlaskit/section-message';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { formatDuration, useLocale, useT } from '../i18n/index.js';
import { progressView, STAGE_SPAN, STAGES } from './progress.js';

const cardStyles = xcss({
  padding: 'space.400',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
  minWidth: '0',
});
const compactCardStyles = xcss({ padding: 'space.300' });
const percentStyles = xcss({ font: 'font.heading.xlarge', color: 'color.text' });
const trackerStyles = xcss({ minWidth: '0', overflowX: 'auto' });

function useElapsed(clock) {
  const [started] = useState(clock);
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [clock]);
  return Math.max(0, now - started);
}

function counterText(t, progress) {
  const phase = progress?.phase ?? 'prepare';
  if (phase === 'read') return t('run.read', { done: progress.done, count: progress.total });
  if (phase === 'images') return t('run.images', { done: progress.done, count: progress.total });
  if (phase === 'build') return t('run.build');
  return t('run.prepare');
}

function trackerItems(t, stage, fraction) {
  const current = STAGES.indexOf(stage);
  return STAGES.map((id, index) => {
    const [from, to] = STAGE_SPAN[id];
    const inside = Math.round(Math.max(0, Math.min(1, (fraction - from) / (to - from))) * 100);
    const status = index < current ? 'visited' : index === current ? 'current' : 'unvisited';
    return { id, label: t(`run.stage.${id}`), status, noLink: true, percentageComplete: index < current ? 100 : index === current ? inside : 0 };
  });
}

/** Running export: stage tracker (read, images, build), percentage, determinate progress bar, counter, elapsed time and cancel. */
export function RunningView({ progress, onCancel, clock = Date.now, compact = false }) {
  const t = useT();
  const locale = useLocale();
  const elapsed = useElapsed(clock);
  const { stage, fraction } = progressView(progress);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
  return (
    <Box xcss={[cardStyles, compact && compactCardStyles]} testId="run-view" data-stage={stage}>
      <Stack space="space.300">
        <Heading size={compact ? 'small' : 'medium'} as="h2">{t('run.title')}</Heading>
        <Box xcss={trackerStyles}>
          <ProgressTracker items={trackerItems(t, stage, fraction)} label={t('run.title')} spacing={compact ? 'compact' : 'cozy'} />
        </Box>
        <Stack space="space.150">
          <Box xcss={percentStyles} testId="run-percent">{percent}</Box>
          <ProgressBar value={fraction} ariaLabel={t('run.title')} testId="run-progress" />
          <Flex gap="space.200" justifyContent="space-between" wrap="wrap" alignItems="center">
            <Text weight="medium" testId="run-counter">{counterText(t, progress)}</Text>
            <Text color="color.text.subtle">{t('run.elapsed', { time: formatDuration(t, elapsed) })}</Text>
          </Flex>
        </Stack>
        <SectionMessage appearance="information">
          <Text>{t('run.keepOpen')}</Text>
        </SectionMessage>
        <Flex justifyContent="end">
          <Button appearance="subtle" onClick={onCancel} testId="run-cancel">{t('run.cancel')}</Button>
        </Flex>
      </Stack>
    </Box>
  );
}
