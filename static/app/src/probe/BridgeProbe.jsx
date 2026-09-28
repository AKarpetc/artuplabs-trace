import { useState } from 'react';
import Button from '@atlaskit/button/new';
import { Box, Stack } from '@atlaskit/primitives';
import { requestConfluence } from '@forge/bridge';
import { zipSync, strToU8 } from 'fflate';

const ATTACHMENT_TEST_LABEL = 'Attachment test';
const ZIP_TEST_LABEL = 'Zip download test';
const RUNNING_LABEL = 'Running…';
const NO_ATTACHMENT_LABEL = 'No attachment found within 30 pages';
const ZIP_SAVED_LABEL = 'Zip bytes written';
const ATTACHMENT_ERROR_LABEL = 'Attachment test failed';
const ZIP_ERROR_LABEL = 'Zip test failed';
const ZIP_FILE_NAME = 'artup-export-probe.zip';
const MAX_PAGES = 30;

/** Error from one named step of the attachment probe (space, homepage, attachments search, download). */
class ProbeStepError extends Error {
  constructor(step, message) {
    super(message);
    this.name = 'ProbeStepError';
    this.step = step;
  }
}

/** Runs `fn`, tagging any rejection with `step` unless it already carries one. */
async function withStep(step, fn) {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof ProbeStepError) throw cause;
    throw new ProbeStepError(step, cause?.message ?? String(cause));
  }
}

async function fetchJson(path, step) {
  return withStep(step, async () => {
    const res = await requestConfluence(path);
    return res.json();
  });
}

/** Snapshot of the view.getContext() fields this probe inspects. */
function contextSnapshot(context) {
  const { locale, siteUrl, environmentType, license, extension, moduleKey } = context ?? {};
  return { locale, siteUrl, environmentType, license, extension, moduleKey };
}

/** Depth-first walk of the space's page tree, up to MAX_PAGES pages, looking for any page with an attachment. */
async function findAttachment(spaceKey) {
  const spacesRes = await fetchJson(`/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`, 'space');
  const homepageId = spacesRes?.results?.[0]?.homepageId;
  if (!homepageId) {
    throw new ProbeStepError('homepage', 'The space response has no homepageId');
  }
  const stack = [homepageId];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_PAGES) {
    const pageId = stack.pop();
    visited += 1;
    const attachmentsRes = await fetchJson(`/wiki/api/v2/pages/${pageId}/attachments?limit=1`, 'attachments search');
    const attachment = attachmentsRes?.results?.[0];
    if (attachment) return attachment;
    const childrenRes = await fetchJson(`/wiki/api/v2/pages/${pageId}/children`, 'attachments search');
    for (const child of childrenRes?.results ?? []) {
      stack.push(child.id);
    }
  }
  return null;
}

/** Downloads the attachment via requestConfluence and compares the received byte count to its declared fileSize. */
async function downloadAttachment(attachment) {
  if (!attachment.downloadLink) {
    throw new ProbeStepError('download', 'The attachment has no downloadLink');
  }
  const start = performance.now();
  const { buffer, blob, typeofArrayBuffer, typeofBlob } = await withStep('download', async () => {
    const response = await requestConfluence(`/wiki${attachment.downloadLink}`);
    const responseTypeofArrayBuffer = typeof response.arrayBuffer;
    const responseTypeofBlob = typeof response.blob;
    const responseBuffer = await response.clone().arrayBuffer();
    const responseBlob = await response.blob();
    return {
      buffer: responseBuffer, blob: responseBlob, typeofArrayBuffer: responseTypeofArrayBuffer, typeofBlob: responseTypeofBlob,
    };
  });
  const elapsedMs = Math.round(performance.now() - start);
  const bytes = buffer.byteLength;
  return {
    found: true,
    typeofArrayBuffer,
    typeofBlob,
    bytes,
    blobSize: blob.size,
    fileSize: attachment.fileSize,
    equal: bytes === attachment.fileSize,
    elapsedMs,
  };
}

async function runAttachmentTest(spaceKey) {
  const attachment = await findAttachment(spaceKey);
  return attachment ? downloadAttachment(attachment) : { found: false };
}

/** Builds a small zip with fflate and saves it through a Blob + <a download> link. */
function runZipTest() {
  const zipped = zipSync({ 'hello/привет.md': strToU8('# Hi\n') });
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = ZIP_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return zipped.byteLength;
}

/** Renders a ProbeStepError (or any Error) as "step: message" / just the message. */
function describeError(error) {
  if (error instanceof ProbeStepError) return `(${error.step}): ${error.message}`;
  return `: ${error?.message ?? String(error)}`;
}

/**
 * Ruling R10: temporary development-only probe verifying the requestConfluence
 * attachment-download bridge and the fflate zip path. Deleted in Task 12.
 */
export function BridgeProbe({ context }) {
  const [attachmentRunning, setAttachmentRunning] = useState(false);
  const [attachmentResult, setAttachmentResult] = useState(null);
  const [attachmentError, setAttachmentError] = useState(null);
  const [zipBytes, setZipBytes] = useState(null);
  const [zipError, setZipError] = useState(null);
  const spaceKey = context?.extension?.space?.key ?? '';

  const onAttachmentTest = async () => {
    setAttachmentRunning(true);
    setAttachmentResult(null);
    setAttachmentError(null);
    try {
      setAttachmentResult(await runAttachmentTest(spaceKey));
    } catch (error) {
      setAttachmentError(error);
    } finally {
      setAttachmentRunning(false);
    }
  };

  const onZipTest = () => {
    setZipError(null);
    setZipBytes(null);
    try {
      setZipBytes(runZipTest());
    } catch (error) {
      setZipError(error);
    }
  };

  return (
    <Stack space="space.200">
      <pre>{JSON.stringify(contextSnapshot(context), null, 2)}</pre>
      <Box>
        <Button onClick={onAttachmentTest} isLoading={attachmentRunning} isDisabled={attachmentRunning}>
          {ATTACHMENT_TEST_LABEL}
        </Button>
      </Box>
      {attachmentRunning ? <pre>{RUNNING_LABEL}</pre> : null}
      {attachmentError ? <pre>{`${ATTACHMENT_ERROR_LABEL} ${describeError(attachmentError)}`}</pre> : null}
      {attachmentResult && !attachmentResult.found ? <pre>{NO_ATTACHMENT_LABEL}</pre> : null}
      {attachmentResult && attachmentResult.found ? <pre>{JSON.stringify(attachmentResult, null, 2)}</pre> : null}
      <Box>
        <Button onClick={onZipTest}>{ZIP_TEST_LABEL}</Button>
      </Box>
      {zipError ? <pre>{`${ZIP_ERROR_LABEL} ${describeError(zipError)}`}</pre> : null}
      {zipBytes !== null ? <pre>{`${ZIP_SAVED_LABEL}: ${zipBytes}`}</pre> : null}
    </Stack>
  );
}
