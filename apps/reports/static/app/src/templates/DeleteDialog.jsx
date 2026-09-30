import Button from '@atlaskit/button/new';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import SectionMessage from '@atlaskit/section-message';
import { Box, Stack, Text, xcss } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';

const nameStyles = xcss({ overflowWrap: 'anywhere' });

/** Confirmation before a template is deleted; names the template, shows a failed attempt's message and locks while deleting. */
export function DeleteDialog({ template, busy = false, error = null, onConfirm, onCancel }) {
  const t = useT();
  return (
    <ModalTransition>
      {template ? (
        <Modal onClose={onCancel} width="small" testId="delete-dialog" label={t('templates.deleteDialog.title')}>
          <ModalHeader hasCloseButton>
            <ModalTitle appearance="danger">{t('templates.deleteDialog.title')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Stack space="space.200">
              <Box xcss={nameStyles}>
                <Text testId="delete-dialog-body">{t('templates.deleteDialog.body', { name: template.name })}</Text>
              </Box>
              {error ? <SectionMessage appearance="error" testId="delete-dialog-error"><Text>{error}</Text></SectionMessage> : null}
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={onCancel} isDisabled={busy} testId="delete-cancel">{t('templates.form.cancel')}</Button>
            <Button appearance="danger" onClick={onConfirm} isLoading={busy} testId="delete-confirm">{t('templates.deleteDialog.confirm')}</Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </ModalTransition>
  );
}
