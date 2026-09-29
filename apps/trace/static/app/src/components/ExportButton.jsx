import { useState } from 'react';
import Button from '@atlaskit/button/new';
import { call, errorMessage } from '../api.js';
import { useT } from '../i18n/index.js';
import { useToasts } from './Toasts.jsx';
import { csvFileName, saveTextFile, withBom } from '../download.js';

const FILE_NAME_KIND = {
  gaps: 'coverage',
  suspects: 'suspects',
};

/**
 * Exports data as a downloaded CSV file: calls the `exportCsv` resolver for
 * the given kind, saves the result to disk, and reports success, truncation
 * or failure as toasts. Disabled while the export is in flight.
 */
export function ExportButton({ kind, projectKey, payload }) {
  const t = useT();
  const { show } = useToasts();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const { csv, truncated } = await call('exportCsv', { ...payload, kind });
      const fileName = csvFileName(FILE_NAME_KIND[kind] ?? 'baseline-diff', projectKey);
      saveTextFile(fileName, withBom(csv));
      show({ title: t('export.done', { fileName }), appearance: 'success' });
      if (truncated) {
        show({ title: t('export.truncated'), appearance: 'warning' });
      }
    } catch (error) {
      show({ title: errorMessage(t, error), appearance: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleClick} isLoading={loading} isDisabled={loading}>
      {t('export.button')}
    </Button>
  );
}
