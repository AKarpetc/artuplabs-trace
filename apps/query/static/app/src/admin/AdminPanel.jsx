import { useCallback, useEffect, useState } from 'react';
import { requestJira } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Heading from '@atlaskit/heading';
import SectionMessage from '@atlaskit/section-message';
import Select from '@atlaskit/select';
import Spinner from '@atlaskit/spinner';
import { Box, Inline, Stack, Text, xcss } from '@atlaskit/primitives';
import { AppError, call, errorMessage } from '../api.js';
import { Card } from '../components/Card.jsx';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { LockIllustration } from '../illustrations/LockIllustration.jsx';
import { IndexProgress } from '../status/IndexProgress.jsx';
import { ResetDialog } from './ResetDialog.jsx';

const PROJECT_PAGE = 100;
const selectStyles = xcss({ maxWidth: '480px' });
const centerStyles = xcss({ display: 'flex', justifyContent: 'center', padding: 'space.400' });

/** Every project the user can see, page by page. */
async function loadProjects() {
  const out = [];
  let startAt = 0;
  while (true) {
    const res = await requestJira(`/rest/api/3/project/search?maxResults=${PROJECT_PAGE}&startAt=${startAt}`);
    if (!res.ok) throw new AppError('generic', `Jira answered ${res.status}`);
    const page = await res.json();
    const values = page.values ?? [];
    out.push(...values.map((p) => ({ key: p.key, name: p.name })));
    if (page.isLast || !values.length) return out;
    startAt += values.length;
  }
}

/** Card with a small heading. */
function Section({ title, children, testId }) {
  return (
    <Card testId={testId}>
      <Stack space="space.200">
        <Heading size="small" as="h2">{title}</Heading>
        {children}
      </Stack>
    </Card>
  );
}

/** Admin settings: projects excluded from the index, the reindex of one project, the rebuild of the whole index and the index progress. */
export function AdminPanel() {
  const t = useT();
  const [load, setLoad] = useState({ status: 'loading' });
  const [excluded, setExcluded] = useState([]);
  const [save, setSave] = useState(null);
  const [reindexKey, setReindexKey] = useState(null);
  const [reindex, setReindex] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [reset, setReset] = useState(null);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await call('adminStatus', {});
      setLoad((current) => (current.status === 'ready' ? { ...current, data: status } : current));
      return status;
    } catch {
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const [status, projects] = await Promise.all([call('adminStatus', {}), loadProjects()]);
      const known = new Set(projects.map((p) => p.key));
      setExcluded(status.excluded.filter((key) => known.has(key)));
      setReindexKey(projects.find((p) => !status.excluded.includes(p.key))?.key ?? null);
      setLoad({ status: 'ready', data: status, projects });
    } catch (error) {
      setLoad({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  if (load.status === 'loading') return <Box xcss={centerStyles}><Spinner size="large" label={t('loading')} /></Box>;
  if (load.status === 'error') {
    const forbidden = load.error instanceof AppError && load.error.code === 'forbidden';
    return (
      <EmptyState
        header={forbidden ? t('admin.forbidden') : errorMessage(t, load.error)}
        renderImage={() => (forbidden ? <LockIllustration size={160} /> : <EmptyIllustration size={160} />)}
        primaryAction={forbidden ? null : <Button appearance="primary" onClick={start}>{t('errors.tryAgain')}</Button>}
        headingLevel={2}
        testId="admin-error"
      />
    );
  }

  const names = new Map(load.projects.map((p) => [p.key, p.name]));
  const option = (key) => ({ value: key, label: names.has(key) ? t('admin.project', { name: names.get(key), key }) : key });
  const included = load.projects.filter((p) => !load.data.excluded.includes(p.key)).map((p) => option(p.key));

  const saveExcluded = async () => {
    setSave({ busy: true });
    try {
      const out = await call('setExcluded', { projectKeys: excluded });
      setExcluded(out.excluded);
      setSave({ saved: true });
      await refreshStatus();
    } catch (error) {
      setSave({ error });
    }
  };

  const startReindex = async () => {
    setReindex({ busy: true });
    try {
      await call('reindexProject', { projectKey: reindexKey });
      setReindex({ started: option(reindexKey).label });
      await refreshStatus();
    } catch (error) {
      setReindex({ error });
    }
  };

  const confirmReset = async () => {
    setReset({ busy: true });
    try {
      await call('resetIndex', {});
      setReset(null);
      setResetOpen(false);
      await refreshStatus();
    } catch (error) {
      setReset({ error });
      setResetOpen(false);
    }
  };

  const reindexBusy = reindex?.error instanceof AppError && reindex.error.code === 'busy';

  return (
    <Stack space="space.400">
      <Section title={t('admin.excluded.title')} testId="admin-excluded">
        <Box xcss={selectStyles}>
          <Select
            inputId="admin-excluded-projects"
            aria-label={t('admin.excluded.title')}
            placeholder={t('admin.excluded.placeholder')}
            isMulti
            options={load.projects.map((p) => option(p.key))}
            value={excluded.map(option)}
            onChange={(values) => {
              setExcluded((values ?? []).map((v) => v.value));
              setSave(null);
            }}
          />
        </Box>
        <SectionMessage appearance="information">
          <Text>{t('admin.excluded.help')}</Text>
        </SectionMessage>
        <Inline space="space.150" alignBlock="center">
          <Button appearance="primary" onClick={saveExcluded} isLoading={Boolean(save?.busy)} testId="save-excluded">{t('admin.excluded.save')}</Button>
          {save?.saved ? <Text color="color.text.success">{t('admin.excluded.saved')}</Text> : null}
        </Inline>
        {save?.error ? <SectionMessage appearance="error"><Text>{errorMessage(t, save.error)}</Text></SectionMessage> : null}
      </Section>

      <Section title={t('admin.reindex.title')} testId="admin-reindex">
        <Text>{t('admin.reindex.help')}</Text>
        <Inline space="space.150" alignBlock="center" shouldWrap>
          <Box xcss={selectStyles}>
            <Select
              inputId="admin-reindex-project"
              aria-label={t('admin.reindex.title')}
              placeholder={t('admin.reindex.placeholder')}
              options={included}
              value={reindexKey ? option(reindexKey) : null}
              onChange={(value) => {
                setReindexKey(value?.value ?? null);
                setReindex(null);
              }}
            />
          </Box>
          <Button onClick={startReindex} isDisabled={!reindexKey} isLoading={Boolean(reindex?.busy)} testId="reindex-action">{t('admin.reindex.action')}</Button>
        </Inline>
        {reindex?.started ? <SectionMessage appearance="success"><Text>{t('admin.reindex.started', { project: reindex.started })}</Text></SectionMessage> : null}
        {reindex?.error ? (
          <SectionMessage appearance={reindexBusy ? 'warning' : 'error'} testId="reindex-error">
            <Text>{reindexBusy ? t('admin.reindex.busy') : errorMessage(t, reindex.error)}</Text>
          </SectionMessage>
        ) : null}
      </Section>

      <Section title={t('admin.reset.title')} testId="admin-reset">
        <Text>{t('admin.reset.help')}</Text>
        <Box>
          <Button appearance="danger" onClick={() => setResetOpen(true)} testId="reset-index">{t('admin.reset.action')}</Button>
        </Box>
        {reset?.error ? <SectionMessage appearance="error"><Text>{errorMessage(t, reset.error)}</Text></SectionMessage> : null}
      </Section>

      {Object.keys(load.data.progress ?? {}).length ? (
        <Section title={t('status.index')} testId="admin-progress">
          <IndexProgress progress={load.data.progress} />
        </Section>
      ) : null}

      <ResetDialog open={resetOpen} busy={Boolean(reset?.busy)} onConfirm={confirmReset} onCancel={() => setResetOpen(false)} />
    </Stack>
  );
}
