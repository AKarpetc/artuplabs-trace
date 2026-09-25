import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@atlaskit/button/new';
import DynamicTable from '@atlaskit/dynamic-table';
import Heading from '@atlaskit/heading';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import { Flex, Inline, Stack, Text } from '@atlaskit/primitives';
import { call, errorMessage } from '../api.js';
import { useT } from '../i18n/index.js';
import { useToasts } from '../components/Toasts.jsx';
import { IssueLink } from '../components/IssueLink.jsx';
import { LoadError, WrapText } from '../project/tableParts.jsx';

/**
 * ArtUp Trace issue panel: whether this issue is a requirement, its
 * coverage state and trace links, with a Confirm action for suspect links.
 */
export function IssueApp({ issueId, projectId }) {
  const t = useT();
  const { show } = useToasts();
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await call('getIssueTrace', { issueId, projectId });
      setTrace(res);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [issueId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm(linkId) {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setConfirming(linkId);
    try {
      const res = await call('confirmLink', { projectId, linkId });
      show({ title: res?.ok ? t('suspects.confirmed') : t('suspects.gone'), appearance: res?.ok ? 'success' : 'warning' });
      await load();
    } catch (e) {
      show({ title: errorMessage(t, e), appearance: 'error' });
    } finally {
      inFlight.current = false;
      setConfirming(null);
    }
  }

  let content;
  if (error) {
    content = <LoadError error={error} onRetry={load} />;
  } else if (!trace) {
    content = <Flex justifyContent="center"><Spinner size="large" /></Flex>;
  } else if (!trace.isRequirement) {
    content = <Text>{t('issue.notRequirement')}</Text>;
  } else {
    const busy = confirming !== null;
    const head = {
      cells: [
        { key: 'link', content: t('table.link') },
        { key: 'other', content: t('table.linkedIssue') },
        { key: 'state', content: '' },
      ],
    };
    const rows = trace.links.map((link) => ({
      key: String(link.linkId),
      cells: [
        { key: 'link', content: <WrapText>{link.linkTypeName}</WrapText> },
        {
          key: 'other',
          content: (
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <IssueLink issueKey={link.otherKey} />
              {link.otherStatus ? <Lozenge>{link.otherStatus}</Lozenge> : null}
            </Inline>
          ),
        },
        {
          key: 'state',
          content: link.suspect ? (
            <Button onClick={() => confirm(link.linkId)} isDisabled={busy} isLoading={confirming === link.linkId}>
              {t('issue.suspect')}
            </Button>
          ) : (
            <Lozenge appearance="success">{t('issue.ok')}</Lozenge>
          ),
        },
      ],
    }));
    content = (
      <Stack space="space.200">
        <Lozenge appearance={trace.covered ? 'success' : 'removed'}>
          {trace.covered ? t('issue.covered') : t('issue.notCovered')}
        </Lozenge>
        <DynamicTable head={head} rows={rows} isFixedSize />
        <Text color="color.text.subtle">{t('issue.refreshNote')}</Text>
      </Stack>
    );
  }

  return (
    <Stack space="space.200">
      <Heading size="medium">{t('app.title')}</Heading>
      {content}
    </Stack>
  );
}
