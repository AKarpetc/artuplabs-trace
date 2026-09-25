import { useCallback, useEffect, useState } from 'react';
import Heading from '@atlaskit/heading';
import Spinner from '@atlaskit/spinner';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { Box, Flex, Stack, xcss } from '@atlaskit/primitives';
import { call } from '../api.js';
import { formatNumber, useLocale, useT } from '../i18n/index.js';
import { SummaryCards } from '../components/SummaryCards.jsx';
import { BaselinesTab } from './BaselinesTab.jsx';
import { CoverageTab } from './CoverageTab.jsx';
import { Onboarding } from './Onboarding.jsx';
import { ProjectHeader } from './ProjectHeader.jsx';
import { SettingsTab } from './SettingsTab.jsx';
import { SuspectTab } from './SuspectTab.jsx';
import { LoadError } from './tableParts.jsx';

const SETTINGS_TAB = 3;

const panelStyles = xcss({ paddingBlockStart: 'space.300', width: '100%' });

/** Loads the suspect-link count from the first suspects page; `count` is `null` while loading, `failed` is set on error. */
function useSuspectCount(projectId, enabled) {
  const [count, setCount] = useState(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    try {
      const res = await call('getSuspects', { projectId, after: '' });
      setCount({ n: res?.rows?.length ?? 0, more: Boolean(res?.next) });
      setFailed(false);
    } catch {
      setCount(null);
      setFailed(true);
    }
  }, [projectId, enabled]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { count, failed, refresh };
}

/** Builds the summary card items from the coverage summary and the suspect count, never showing NaN. */
function cardItems(t, locale, coverage, suspects, suspectsFailed) {
  const total = Number(coverage?.total) || 0;
  const covered = Number(coverage?.covered) || 0;
  const uncovered = Math.max(total - covered, 0);
  const percent = total ? Number(coverage?.percent) || 0 : 0;
  let suspectValue = <Spinner size="small" />;
  if (suspects) {
    suspectValue = `${formatNumber(locale, suspects.n)}${suspects.more ? '+' : ''}`;
  } else if (suspectsFailed) {
    suspectValue = t('common.none');
  }
  return [
    { label: t('cards.coverage'), value: t('cards.percent', { value: formatNumber(locale, percent) }), appearance: total && !uncovered ? 'success' : undefined },
    { label: t('cards.uncovered'), value: formatNumber(locale, uncovered), appearance: uncovered ? 'danger' : undefined },
    { label: t('cards.suspects'), value: suspectValue, appearance: suspects?.n ? 'warning' : undefined },
    { label: t('cards.requirements'), value: formatNumber(locale, total) },
  ];
}

/** ArtUp Trace project page: header with sync state, summary cards and the Coverage, Suspect links, Baselines and Settings tabs. */
export function ProjectApp({ projectId, projectKey }) {
  const t = useT();
  const locale = useLocale();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(0);
  const configured = Boolean(overview?.configured);
  const suspects = useSuspectCount(projectId, configured);

  const load = useCallback(async () => {
    try {
      setOverview(await call('getOverview', { projectId }));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshSuspects = suspects.refresh;
  const onSettingsSaved = useCallback(() => {
    load();
    refreshSuspects();
  }, [load, refreshSuspects]);

  if (!overview) {
    return (
      <Stack space="space.400">
        <Heading size="large">{t('app.title')}</Heading>
        {error ? <LoadError error={error} onRetry={load} /> : <Flex justifyContent="center"><Spinner size="large" /></Flex>}
      </Stack>
    );
  }

  const onboarding = <Onboarding onOpenSettings={() => setSelected(SETTINGS_TAB)} />;

  return (
    <Stack space="space.400">
      <ProjectHeader overview={overview} />
      {error ? <LoadError error={error} onRetry={load} /> : null}
      {configured ? <SummaryCards items={cardItems(t, locale, overview.coverage, suspects.count, suspects.failed)} /> : null}
      <Tabs id="artup-trace-tabs" selected={selected} onChange={setSelected}>
        <TabList>
          <Tab>{t('tabs.coverage')}</Tab>
          <Tab>{t('tabs.suspects')}</Tab>
          <Tab>{t('tabs.baselines')}</Tab>
          <Tab>{t('tabs.settings')}</Tab>
        </TabList>
        <TabPanel>
          <Box xcss={panelStyles}>
            {configured ? <CoverageTab projectId={projectId} projectKey={projectKey} coverage={overview.coverage} /> : onboarding}
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={panelStyles}>
            {configured ? <SuspectTab projectId={projectId} projectKey={projectKey} onChanged={suspects.refresh} /> : onboarding}
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={panelStyles}>
            {configured ? <BaselinesTab projectId={projectId} projectKey={projectKey} /> : onboarding}
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={panelStyles}>
            <SettingsTab projectId={projectId} onSaved={onSettingsSaved} />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
}
