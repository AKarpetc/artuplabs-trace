import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, CodeBlock, DynamicTable, EmptyState, Form, FormFooter, Heading, Inline, Label,
  Lozenge, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition, ProgressBar, SectionMessage,
  Select, Spinner, Stack, Tab, TabList, TabPanel, Tabs, Text, Textfield, useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

function errorText(error) {
  const message = String(error?.message ?? error);
  if (message.includes('no-permission')) {
    return 'You do not have permission for this action in this project.';
  }
  if (message.includes('unlicensed')) {
    return 'ArtUp Trace license is not active on this site.';
  }
  return message;
}

function CsvModal({ csv, truncated, onClose }) {
  return (
    <ModalTransition>
      {csv !== null && (
        <Modal onClose={onClose} width="x-large">
          <ModalHeader><ModalTitle>CSV export</ModalTitle></ModalHeader>
          <ModalBody>
            <Stack space="space.100">
              {truncated && <SectionMessage appearance="warning"><Text>Only the first 5 000 rows are included.</Text></SectionMessage>}
              <Text>Copy the text below and save it as a .csv file.</Text>
              <CodeBlock language="text" text={csv} />
            </Stack>
          </ModalBody>
          <ModalFooter><Button onClick={onClose}>Close</Button></ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}

function useExport(projectId) {
  const [csv, setCsv] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null);
  const run = async (payload) => {
    try {
      const res = await invoke('exportCsv', { projectId, ...payload });
      setTruncated(res.truncated);
      setCsv(res.csv);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return { csv, truncated, error, run, close: () => setCsv(null) };
}

function CoverageTab({ projectId, overview }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const exporter = useExport(projectId);
  const load = useCallback(async (after) => {
    try {
      const res = await invoke('getGaps', { projectId, after });
      setRows((prev) => (after ? [...prev, ...res.rows] : res.rows));
      setNext(res.next);
      setLoadError(null);
      setLoaded(true);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [projectId]);
  useEffect(() => { load(''); }, [load]);
  const c = overview.coverage;
  if (c.total === 0) {
    return <EmptyState header="No requirements found" description="No issues of the requirement types were found yet. If you just saved settings, the first sync may take up to an hour on large projects." />;
  }
  return (
    <Stack space="space.200">
      <Heading as="h3">{`${c.percent}% covered — ${c.covered} of ${c.total} requirements`}</Heading>
      <ProgressBar value={c.total ? c.covered / c.total : 0} />
      <Inline space="space.100"><Text>{`${c.uncovered} without a verification link`}</Text><Button onClick={() => exporter.run({ kind: 'gaps' })}>Export CSV</Button></Inline>
      {exporter.error && <SectionMessage appearance="error"><Text>{exporter.error}</Text></SectionMessage>}
      {loadError && <SectionMessage appearance="error"><Text>{loadError}</Text></SectionMessage>}
      {!loadError && !loaded && <Spinner />}
      {!loadError && loaded && (
        <DynamicTable
          head={{ cells: [{ key: 'k', content: 'Requirement' }, { key: 's', content: 'Summary' }, { key: 't', content: 'Status' }] }}
          rows={rows.map((r) => ({ key: r.issueId, cells: [{ key: 'k', content: r.issueKey }, { key: 's', content: r.summary }, { key: 't', content: r.statusName }] }))}
        />
      )}
      {!loadError && loaded && next && <Button onClick={() => load(next)}>Load more</Button>}
      <CsvModal csv={exporter.csv} truncated={exporter.truncated} onClose={exporter.close} />
    </Stack>
  );
}

function SuspectTab({ projectId }) {
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const exporter = useExport(projectId);
  const load = useCallback(async (after) => {
    try {
      const res = await invoke('getSuspects', { projectId, after });
      setRows((prev) => (after ? [...prev, ...res.rows] : res.rows));
      setNext(res.next);
      setLoadError(null);
      setLoaded(true);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [projectId]);
  useEffect(() => { load(''); }, [load]);
  const confirm = async (linkId) => {
    try {
      const res = await invoke('confirmLink', { projectId, linkId });
      if (!res.ok) {
        setNotice('This link no longer exists; the list was refreshed.');
        await load('');
        return;
      }
      setNotice(null);
      setRows((prev) => prev.filter((r) => r.linkId !== linkId));
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (loadError) {
    return <SectionMessage appearance="error"><Text>{loadError}</Text></SectionMessage>;
  }
  if (!loaded) {
    return <Spinner />;
  }
  if (!rows.length) {
    return <EmptyState header="No suspect links" description="A link becomes suspect when its requirement's summary or description changes after the link was confirmed." />;
  }
  return (
    <Stack space="space.200">
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {notice && <SectionMessage appearance="information"><Text>{notice}</Text></SectionMessage>}
      {exporter.error && <SectionMessage appearance="error"><Text>{exporter.error}</Text></SectionMessage>}
      <Inline space="space.100"><Text>{`${rows.length}${next ? '+' : ''} suspect links`}</Text><Button onClick={() => exporter.run({ kind: 'suspects' })}>Export CSV</Button></Inline>
      <DynamicTable
        head={{ cells: [{ key: 'r', content: 'Requirement' }, { key: 's', content: 'Summary' }, { key: 'l', content: 'Link' }, { key: 'o', content: 'Linked issue' }, { key: 'a', content: '' }] }}
        rows={rows.map((r) => ({
          key: r.linkId,
          cells: [
            { key: 'r', content: r.reqKey },
            { key: 's', content: r.reqSummary },
            { key: 'l', content: r.linkTypeName },
            { key: 'o', content: `${r.otherKey} (${r.otherStatus})` },
            { key: 'a', content: <Button onClick={() => confirm(r.linkId)}>Confirm</Button> },
          ],
        }))}
      />
      {next && <Button onClick={() => load(next)}>Load more</Button>}
      <CsvModal csv={exporter.csv} truncated={exporter.truncated} onClose={exporter.close} />
    </Stack>
  );
}

function BaselinesTab({ projectId }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);
  const exporter = useExport(projectId);
  const options = list.filter((b) => b.status === 'complete').map((b) => ({ label: `${b.name} — ${b.createdAt.slice(0, 10)} (${b.memberCount})`, value: b.id }));
  const refresh = useCallback(async () => {
    try {
      const nextList = await invoke('listBaselines', { projectId });
      setList(nextList);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [projectId]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const ids = new Set(list.filter((b) => b.status === 'complete').map((b) => b.id));
    setLeft((prev) => (prev && !ids.has(prev.value) ? null : prev));
    setRight((prev) => (prev && !ids.has(prev.value) ? null : prev));
  }, [list]);
  const create = async () => {
    try {
      await invoke('createBaseline', { projectId, name });
      setName('');
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const compare = async () => {
    try {
      const res = await invoke('getDiff', { projectId, leftId: left.value, rightId: right.value, after: '' });
      setDiff(res);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const loadMoreDiff = async () => {
    try {
      const res = await invoke('getDiff', { projectId, leftId: left.value, rightId: right.value, after: diff.next });
      setDiff((prev) => ({ counts: prev.counts, rows: [...prev.rows, ...res.rows], next: res.next }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Stack space="space.300">
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {exporter.error && <SectionMessage appearance="error"><Text>{exporter.error}</Text></SectionMessage>}
      <Inline space="space.100" alignBlock="end">
        <Box><Label labelFor="bl-name">New baseline name</Label><Textfield id="bl-name" value={name} onChange={(e) => setName(e.target.value)} /></Box>
        <Button appearance="primary" isDisabled={!name.trim()} onClick={create}>Create baseline</Button>
        <Button onClick={refresh}>Refresh</Button>
      </Inline>
      <DynamicTable
        head={{ cells: [{ key: 'n', content: 'Name' }, { key: 'd', content: 'Created' }, { key: 'c', content: 'Requirements' }, { key: 's', content: 'Status' }] }}
        rows={list.map((b) => ({
          key: String(b.id),
          cells: [
            { key: 'n', content: b.name },
            { key: 'd', content: b.createdAt.slice(0, 16).replace('T', ' ') },
            { key: 'c', content: String(b.memberCount) },
            { key: 's', content: <Lozenge appearance={b.status === 'complete' ? 'success' : b.status === 'failed' ? 'removed' : 'inprogress'}>{b.status}</Lozenge> },
          ],
        }))}
      />
      <Heading as="h4">Compare two baselines</Heading>
      <Inline space="space.100" alignBlock="end">
        <Box><Label labelFor="bl-left">Before</Label><Select inputId="bl-left" options={options} value={left} onChange={setLeft} /></Box>
        <Box><Label labelFor="bl-right">After</Label><Select inputId="bl-right" options={options} value={right} onChange={setRight} /></Box>
        <Button isDisabled={!left || !right || left.value === right.value} onClick={compare}>Compare</Button>
      </Inline>
      {diff && (
        <Stack space="space.100">
          <Text>{`Added ${diff.counts.added} · Removed ${diff.counts.removed} · Changed ${diff.counts.changed} · Links changed ${diff.counts.linksChanged}`}</Text>
          <Button onClick={() => exporter.run({ kind: 'diff', leftId: left.value, rightId: right.value })}>Export CSV</Button>
          <DynamicTable
            head={{ cells: [{ key: 'k', content: 'Requirement' }, { key: 's', content: 'Summary' }, { key: 'c', content: 'Change' }, { key: 'b', content: 'Status before → after' }] }}
            rows={diff.rows.map((r) => ({ key: r.issueId, cells: [{ key: 'k', content: r.issueKey }, { key: 's', content: r.summary }, { key: 'c', content: r.change }, { key: 'b', content: `${r.leftStatus || '—'} → ${r.rightStatus || '—'}` }] }))}
          />
          {diff.next && <Button onClick={loadMoreDiff}>Load more</Button>}
        </Stack>
      )}
      <CsvModal csv={exporter.csv} truncated={exporter.truncated} onClose={exporter.close} />
    </Stack>
  );
}

function SettingsTab({ projectId, onSaved }) {
  const [types, setTypes] = useState([]);
  const [linkTypes, setLinkTypes] = useState([]);
  const [config, setConfig] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        setTypes(await invoke('getIssueTypes', { projectId }));
        setLinkTypes(await invoke('getLinkTypes', { projectId }));
        setConfig(await invoke('getSettings', { projectId }));
      } catch (e) {
        setErrors([errorText(e)]);
      }
    })();
  }, [projectId]);
  if (errors.length && !config) {
    return <SectionMessage appearance="warning"><Text>{errors[0]}</Text></SectionMessage>;
  }
  if (!config) {
    return <Spinner />;
  }
  const opts = (list) => list.map((t) => ({ label: t.name, value: t.id }));
  const pick = (list, ids) => opts(list).filter((o) => ids.includes(o.value));
  const setIds = (key) => (selected) => setConfig({ ...config, [key]: (selected ?? []).map((s) => s.value) });
  const save = async () => {
    try {
      const res = await invoke('saveSettings', { projectId, config });
      setErrors(res.errors);
      setSaved(res.errors.length === 0);
      if (!res.errors.length) {
        onSaved();
      }
    } catch (e) {
      setErrors([errorText(e)]);
      setSaved(false);
    }
  };
  return (
    <Form onSubmit={save}>
      <Stack space="space.200">
        {errors.map((e) => <SectionMessage key={e} appearance="error"><Text>{e}</Text></SectionMessage>)}
        {saved && <SectionMessage appearance="success"><Text>Saved. Sync started in the background.</Text></SectionMessage>}
        <Box><Label labelFor="req-types">Requirement issue types</Label><Select inputId="req-types" isMulti options={opts(types)} value={pick(types, config.requirementTypeIds)} onChange={setIds('requirementTypeIds')} /></Box>
        <Box><Label labelFor="ver-types">Verification issue types (tests, tasks that prove a requirement)</Label><Select inputId="ver-types" isMulti options={opts(types)} value={pick(types, config.verificationTypeIds)} onChange={setIds('verificationTypeIds')} /></Box>
        <Box><Label labelFor="link-types">Link types that count (empty = any)</Label><Select inputId="link-types" isMulti options={opts(linkTypes)} value={pick(linkTypes, config.linkTypeIds)} onChange={setIds('linkTypeIds')} /></Box>
        <Text>Links become suspect when the requirement's summary or description changes.</Text>
        <FormFooter><ButtonGroup><Button type="submit" appearance="primary">Save</Button></ButtonGroup></FormFooter>
      </Stack>
    </Form>
  );
}

const App = () => {
  const context = useProductContext();
  const projectId = context?.extension?.project?.id;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      setOverview(await invoke('getOverview', { projectId }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [projectId]);
  useEffect(() => {
    if (projectId) {
      load();
    }
  }, [projectId, load]);
  if (error) {
    return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  }
  if (!overview) {
    return <Spinner />;
  }
  const job = overview.sync.job;
  return (
    <Stack space="space.200">
      {!overview.configured && <SectionMessage appearance="information" title="Configure requirement types"><Text>Open the Settings tab and choose which issue types are requirements and which verify them.</Text></SectionMessage>}
      {job && ['running', 'waiting'].includes(job.status) && <SectionMessage appearance="information"><Text>{`Sync in progress: ${job.state.pages} pages read. Results update as it runs.`}</Text></SectionMessage>}
      {job?.status === 'failed' && <SectionMessage appearance="error"><Text>{`Last sync failed: ${job.error}`}</Text></SectionMessage>}
      {overview.sync.lastSyncedAt && <Text>{`Last synced ${overview.sync.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC`}</Text>}
      <Tabs id="trace-tabs">
        <TabList>
          <Tab>Coverage</Tab>
          <Tab>Suspect links</Tab>
          <Tab>Baselines</Tab>
          <Tab>Settings</Tab>
        </TabList>
        <TabPanel>{overview.configured ? <CoverageTab projectId={projectId} overview={overview} /> : <Text>Not configured yet.</Text>}</TabPanel>
        <TabPanel>{overview.configured ? <SuspectTab projectId={projectId} /> : <Text>Not configured yet.</Text>}</TabPanel>
        <TabPanel>{overview.configured ? <BaselinesTab projectId={projectId} /> : <Text>Not configured yet.</Text>}</TabPanel>
        <TabPanel><SettingsTab projectId={projectId} onSaved={load} /></TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
