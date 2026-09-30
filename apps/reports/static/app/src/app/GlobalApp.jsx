import { useState } from 'react';
import Tabs, { Tab, TabList } from '@atlaskit/tabs';
import { Box, Stack, xcss } from '@atlaskit/primitives';
import { AppHeader } from '../components/AppHeader.jsx';
import { PageLayout } from '../components/PageLayout.jsx';
import { useT } from '../i18n/index.js';
import { TemplatesTab } from '../templates/TemplatesTab.jsx';
import { Wizard } from '../wizard/Wizard.jsx';
import { AccessGate } from './AccessGate.jsx';

const NO_ENTRY = { kind: 'none' };
const STORAGE_KEY = 'reports.globalTab';
const TAB_COUNT = 2;

const pageStyles = xcss({ padding: 'space.300' });
const hiddenStyles = xcss({ display: 'none' });

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

/** Global page: licence gate, header and the Export / Templates tabs; the chosen tab is remembered in localStorage. */
export function GlobalApp({ context }) {
  const t = useT();
  const [selected, setSelected] = useState(readTab);
  const choose = (index) => {
    setSelected(index);
    writeTab(index);
  };
  return (
    <Box xcss={pageStyles}>
      <AccessGate>
        <PageLayout
          main={(
            <Stack space="space.400">
              <AppHeader subtitle={t('app.tagline')} />
              <Tabs id="global-tabs" selected={selected} onChange={choose}>
                <TabList>
                  <Tab testId="tab-export">{t('tabs.export')}</Tab>
                  <Tab testId="tab-templates">{t('templates.title')}</Tab>
                </TabList>
              </Tabs>
              <Box role="tabpanel" xcss={selected === 0 ? undefined : hiddenStyles} testId="panel-export">
                <Wizard entry={NO_ENTRY} context={context} />
              </Box>
              {selected === 1 ? <Box role="tabpanel" testId="panel-templates"><TemplatesTab /></Box> : null}
            </Stack>
          )}
        />
      </AccessGate>
    </Box>
  );
}
