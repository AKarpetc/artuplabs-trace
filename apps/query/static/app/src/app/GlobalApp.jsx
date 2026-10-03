import { useState } from 'react';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Skeleton from '@atlaskit/skeleton';
import Tabs, { Tab, TabList } from '@atlaskit/tabs';
import { token } from '@atlaskit/tokens';
import { Box, Stack, xcss } from '@atlaskit/primitives';
import { errorMessage } from '../api.js';
import { AppHeader } from '../components/AppHeader.jsx';
import { Card } from '../components/Card.jsx';
import { RefreshIcon } from '../components/icons.js';
import { PageLayout } from '../components/PageLayout.jsx';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { FunctionReference } from '../reference/FunctionReference.jsx';
import { StatusPanel } from '../status/StatusPanel.jsx';
import { AccessGate } from './AccessGate.jsx';
import { useStatus } from './useStatus.js';

const STORAGE_KEY = 'query.globalTab';
const TAB_COUNT = 2;
const POLL_MS = 15000;
const SKELETON_CARDS = [0, 1, 2];

const pageStyles = xcss({ padding: 'space.300' });

const readTab = () => {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value >= 0 && value < TAB_COUNT ? value : 0;
  } catch {
    return 0;
  }
};

const writeTab = (index) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(index));
  } catch {
    return;
  }
};

/** Skeleton cards in place of the tab content while the status loads. */
function LoadingCards() {
  return (
    <Stack space="space.200" testId="status-loading">
      {SKELETON_CARDS.map((i) => (
        <Card key={i}>
          <Stack space="space.150">
            <Skeleton width="240px" height="20px" borderRadius={token('radius.small')} />
            <Skeleton width="100%" height="40px" borderRadius={token('radius.medium')} />
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

/** Header with the refresh action, the Functions / Status tabs and the content of the chosen tab. */
function GlobalPage() {
  const t = useT();
  const status = useStatus(POLL_MS);
  const [selected, setSelected] = useState(readTab);
  const choose = (index) => {
    setSelected(index);
    writeTab(index);
  };
  const body = () => {
    if (status.status === 'loading') return <LoadingCards />;
    if (status.status === 'error') {
      return (
        <EmptyState
          header={errorMessage(t, status.error)}
          renderImage={() => <EmptyIllustration size={160} />}
          primaryAction={<Button appearance="primary" onClick={status.reload}>{t('errors.tryAgain')}</Button>}
          headingLevel={2}
        />
      );
    }
    return selected === 0 ? <FunctionReference functions={status.data.functions} /> : <StatusPanel status={status.data} />;
  };
  return (
    <Stack space="space.400">
      <AppHeader
        subtitle={t('app.tagline')}
        actions={<Button iconBefore={RefreshIcon} onClick={status.reload} testId="status-refresh">{t('status.refresh')}</Button>}
      />
      <Tabs id="global-tabs" selected={selected} onChange={choose}>
        <TabList>
          <Tab testId="tab-functions">{t('tabs.functions')}</Tab>
          <Tab testId="tab-status">{t('tabs.status')}</Tab>
        </TabList>
      </Tabs>
      <Box role="tabpanel">{body()}</Box>
    </Stack>
  );
}

/** Global page: licence gate, then the function reference and the refresh status; the chosen tab is remembered in localStorage. */
export function GlobalApp() {
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <PageLayout main={<GlobalPage />} />
      </AccessGate>
    </Box>
  );
}
