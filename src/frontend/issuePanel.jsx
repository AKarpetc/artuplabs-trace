import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Button, DynamicTable, Lozenge, SectionMessage, Spinner, Stack, Text, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const context = useProductContext();
  const issueId = context?.extension?.issue?.id;
  const projectId = context?.extension?.project?.id;
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => {
    try {
      setTrace(await invoke('getIssueTrace', { issueId, projectId }));
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  }, [issueId, projectId]);
  useEffect(() => {
    if (issueId) {
      load();
    }
  }, [issueId, load]);
  if (error) {
    return <SectionMessage appearance="warning"><Text>{error}</Text></SectionMessage>;
  }
  if (!trace) {
    return <Spinner />;
  }
  if (!trace.isRequirement) {
    return <Text>This issue is not tracked as a requirement. Configure requirement types on the project's ArtUp Trace page.</Text>;
  }
  const confirm = async (linkId) => {
    try {
      const res = await invoke('confirmLink', { projectId, linkId });
      setNotice(res.ok ? null : 'This link no longer exists; the list was refreshed.');
      await load();
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };
  return (
    <Stack space="space.100">
      {notice && <SectionMessage appearance="information"><Text>{notice}</Text></SectionMessage>}
      <Lozenge appearance={trace.covered ? 'success' : 'removed'}>{trace.covered ? 'Covered' : 'Not covered'}</Lozenge>
      <DynamicTable
        head={{ cells: [{ key: 'l', content: 'Link' }, { key: 'o', content: 'Issue' }, { key: 's', content: 'State' }] }}
        rows={trace.links.map((l) => ({
          key: l.linkId,
          cells: [
            { key: 'l', content: l.linkTypeName },
            { key: 'o', content: `${l.otherKey} (${l.otherStatus})` },
            { key: 's', content: l.suspect ? <Button onClick={() => confirm(l.linkId)}>Suspect — confirm</Button> : <Lozenge appearance="success">OK</Lozenge> },
          ],
        }))}
      />
      <Text>Data refreshes within a few minutes of changes.</Text>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
