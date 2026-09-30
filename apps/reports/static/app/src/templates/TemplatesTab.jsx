import { useMemo, useState } from 'react';
import Button from '@atlaskit/button/new';
import Heading from '@atlaskit/heading';
import Skeleton from '@atlaskit/skeleton';
import { token } from '@atlaskit/tokens';
import { Box, Flex, Stack, Text, xcss } from '@atlaskit/primitives';
import { ChoiceGroup } from '../components/ChoiceCard.jsx';
import { PageIcon, TableIcon } from '../components/icons.js';
import { useT } from '../i18n/index.js';
import { createBridgeClient } from '../infra/bridge.js';
import { saveBlob } from '../infra/download.js';
import { InlineState, runErrorMessage } from '../wizard/FailureView.jsx';
import { labelsFor } from '../wizard/labels.js';
import { useCatalog } from '../wizard/useCatalog.js';
import { DeleteDialog } from './DeleteDialog.jsx';
import { DocxUploadForm } from './DocxUploadForm.jsx';
import { ExcelTemplateForm } from './ExcelTemplateForm.jsx';
import { TemplatesTable } from './TemplatesTable.jsx';
import { useTemplateAdmin } from './useTemplateAdmin.js';

const LIST = { mode: 'list' };
const KIND_COLUMNS = 'repeat(auto-fit, minmax(260px, 1fr))';
const headerStyles = xcss({ minWidth: '0' });

function Loading() {
  return (
    <Stack space="space.200" testId="templates-loading">
      <Skeleton width="180px" height="20px" borderRadius={token('radius.small')} />
      <Skeleton width="100%" height="40px" borderRadius={token('radius.medium')} />
      <Skeleton width="100%" height="40px" borderRadius={token('radius.medium')} />
      <Skeleton width="100%" height="40px" borderRadius={token('radius.medium')} />
    </Stack>
  );
}

function KindChooser({ onChoose, onCancel }) {
  const t = useT();
  const [kind, setKind] = useState('xlsx');
  const options = [
    { value: 'xlsx', icon: TableIcon, accent: 'teal', title: t('templates.kind.xlsx.title'), description: t('templates.kind.xlsx.description'), testId: 'kind-xlsx' },
    { value: 'docx', icon: PageIcon, accent: 'blue', title: t('templates.kind.docx.title'), description: t('templates.kind.docx.description'), testId: 'kind-docx' },
  ];
  return (
    <Stack space="space.300" testId="template-kinds">
      <Heading size="medium" as="h2">{t('templates.create')}</Heading>
      <ChoiceGroup label={t('templates.create')} value={kind} options={options} onChange={setKind} columns={KIND_COLUMNS} />
      <Flex gap="space.100" wrap="wrap">
        <Button appearance="primary" onClick={() => onChoose(kind)} testId="kinds-continue">{t('templates.form.continue')}</Button>
        <Button appearance="subtle" onClick={onCancel} testId="kinds-cancel">{t('templates.form.cancel')}</Button>
      </Flex>
    </Stack>
  );
}

/**
 * Templates tab: the templates the caller can see in a table per group, and the forms to create, edit and delete them.
 * `save` stores the example Word template; `createClient`, `callResolver`, `request`, `retryDelays` and `loadLibs` are injectable.
 */
export function TemplatesTab({ createClient = createBridgeClient, save = saveBlob, callResolver, request, retryDelays, loadLibs }) {
  const t = useT();
  const admin = useTemplateAdmin({ ...(callResolver ? { callResolver } : {}), ...(request ? { request } : {}), ...(retryDelays ? { retryDelays } : {}) });
  const client = useMemo(() => createClient({}), [createClient]);
  const catalog = useCatalog(client);
  const labels = useMemo(() => labelsFor(t), [t]);
  const [view, setView] = useState(LIST);
  const [deleting, setDeleting] = useState(null);
  const [removal, setRemoval] = useState({ busy: false, error: null });

  const finish = () => {
    setView(LIST);
    admin.reload();
  };
  const closeDelete = () => {
    setDeleting(null);
    setRemoval({ busy: false, error: null });
  };
  const confirmDelete = async () => {
    setRemoval({ busy: true, error: null });
    try {
      await admin.remove(deleting.id);
      closeDelete();
      admin.reload();
    } catch (error) {
      setRemoval({ busy: false, error: runErrorMessage(t, error) });
    }
  };

  const formProps = { admin, catalog, scopes: admin.scopes, projects: admin.projects, onDone: finish, onCancel: () => setView(LIST) };
  if (admin.status === 'ready' && view.mode === 'excel') return <ExcelTemplateForm {...formProps} template={view.template} labels={labels} />;
  if (admin.status === 'ready' && view.mode === 'docx') return <DocxUploadForm {...formProps} template={view.template} save={save} loadLibs={loadLibs} />;
  if (admin.status === 'ready' && view.mode === 'choose') return <KindChooser onChoose={(kind) => setView({ mode: kind === 'docx' ? 'docx' : 'excel', template: null })} onCancel={() => setView(LIST)} />;

  const hasTemplates = admin.status === 'ready' && Object.values(admin.groups).some((list) => list.length > 0);
  const edit = (template) => setView({ mode: template.kind === 'docx' ? 'docx' : 'excel', template });
  return (
    <Stack space="space.400" testId="templates-tab">
      <Flex justifyContent="space-between" alignItems="start" gap="space.200" wrap="wrap">
        <Stack space="space.050" xcss={headerStyles}>
          <Heading size="medium" as="h2">{t('templates.title')}</Heading>
          <Text color="color.text.subtle">{t('templates.description')}</Text>
        </Stack>
        {hasTemplates ? <Button appearance="primary" onClick={() => setView({ mode: 'choose' })} testId="templates-create">{t('templates.create')}</Button> : null}
      </Flex>
      {admin.status === 'loading' ? <Loading /> : null}
      {admin.status === 'error' ? (
        <InlineState tone="error" text={runErrorMessage(t, admin.error)} action={<Button onClick={admin.reload}>{t('errors.tryAgain')}</Button>} testId="templates-error" />
      ) : null}
      {admin.status === 'ready' ? (
        <TemplatesTable
          groups={admin.groups}
          scopes={admin.scopes}
          authors={admin.authors}
          onEdit={edit}
          onDelete={setDeleting}
          onCreate={() => setView({ mode: 'choose' })}
        />
      ) : null}
      <DeleteDialog template={deleting} busy={removal.busy} error={removal.error} onConfirm={confirmDelete} onCancel={closeDelete} />
    </Stack>
  );
}
