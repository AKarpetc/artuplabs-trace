import { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import ProgressBar from '@atlaskit/progress-bar';
import { ProgressTracker } from '@atlaskit/progress-tracker';
import SectionMessage from '@atlaskit/section-message';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { formatDuration, useLocale, useT } from '../i18n/index.js';

/** Export stages in run order. */
export const STAGES = ['scan', 'pages', 'attachments', 'pack'];

const SPAN = { scan: [0, 0.05], pages: [0.05, 0.8], attachments: [0.8, 0.95], pack: [0.95, 1] };
const ETA_FROM = 0.05;

const cardStyles = xcss({
  padding: 'space.400',
  borderRadius: 'radius.large',
  backgroundColor: 'elevation.surface.raised',
  boxShadow: 'elevation.shadow.raised',
});
const compactCardStyles = xcss({ padding: 'space.300' });
const percentStyles = xcss({ font: 'font.heading.xlarge', color: 'color.text' });
const compactPercentStyles = xcss({ font: 'font.heading.large' });
const trackerStyles = xcss({ minWidth: '0', overflowX: 'auto' });

/** Overall completion 0…1 from a pipeline progress event; the scan stage counts as 0 (its total is unknown). */
export function overallFraction(progress) {
  if (!progress || progress.stage === 'scan') return 0;
  const [from, to] = SPAN[progress.stage] ?? [0, 0];
  const part = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 1;
  return from + (to - from) * part;
}

function useNow(clock) {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [clock]);
  return now;
}

function counterText(t, progress) {
  if (progress.stage === 'pages') return t('run.counter', { done: progress.done, count: progress.total });
  if (progress.stage === 'attachments') return t('run.counterAttachments', { done: progress.done, count: progress.total });
  if (progress.stage === 'pack') return t('run.packing');
  return t('run.scanned', { count: progress.done });
}

function trackerItems(t, stage, fraction) {
  const current = STAGES.indexOf(stage);
  return STAGES.map((id, index) => {
    const status = index < current ? 'visited' : index === current ? 'current' : 'unvisited';
    const [from, to] = SPAN[id];
    const inside = Math.max(0, Math.min(1, (fraction - from) / (to - from)));
    return { id, label: t(`run.stage.${id}`), status, noLink: true, percentageComplete: index < current ? 100 : index === current ? Math.round(inside * 100) : 0 };
  });
}

/**
 * Running export: stage tracker, big percentage, progress bar, counters, elapsed time and ETA, cancel.
 * `hint` replaces the keep-the-tab-open note; `compact` tightens padding and type for a modal.
 */
export function RunningView({ progress, startedAt, onCancel, clock = Date.now, hint, compact = false }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(clock);
  const current = progress ?? { stage: 'scan', done: 0, total: 0 };
  const fraction = overallFraction(current);
  const elapsed = Math.max(0, now - startedAt);
  const eta = fraction >= ETA_FROM && fraction < 1 ? (elapsed / fraction) * (1 - fraction) : null;
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
  return (
    <Box xcss={[cardStyles, compact && compactCardStyles]} testId="run-view" data-density={compact ? 'compact' : undefined}>
      <Stack space="space.300">
        <Heading size={compact ? 'small' : 'medium'} as="h2">{t('run.title')}</Heading>
        <Box xcss={trackerStyles}>
          <ProgressTracker items={trackerItems(t, current.stage, fraction)} label={t('run.title')} spacing={compact ? 'compact' : 'cozy'} />
        </Box>
        <Stack space="space.150">
          <Box xcss={[percentStyles, compact && compactPercentStyles]} testId="run-percent">{percent}</Box>
          <ProgressBar value={fraction} isIndeterminate={current.stage === 'scan'} ariaLabel={t('run.title')} />
          <Flex gap="space.200" justifyContent="space-between" wrap="wrap" alignItems="center">
            <Text weight="medium">{counterText(t, current)}</Text>
            <Flex gap="space.200" wrap="wrap">
              <Text color="color.text.subtle">{t('run.elapsed', { time: formatDuration(t, elapsed) })}</Text>
              {eta !== null ? <Text color="color.text.subtle">{t('run.eta', { time: formatDuration(t, eta) })}</Text> : null}
            </Flex>
          </Flex>
        </Stack>
        <SectionMessage appearance="information">
          <Text>{hint ?? t('run.keepOpen')}</Text>
        </SectionMessage>
        <Flex justifyContent="end">
          <Button appearance="subtle" onClick={onCancel} testId="run-cancel">{t('run.cancel')}</Button>
        </Flex>
      </Stack>
    </Box>
  );
}
