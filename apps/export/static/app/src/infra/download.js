/** Saves a Blob as a file through a temporary download link (needs a user gesture). */
export function saveBlob(fileName, blob, doc = document) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Zip name: artup-export-<space>[-<root>]-<YYYY-MM-DD>[-update].zip in the user's local date. */
export function exportFileName({ spaceKey, rootSlug, mode, now }) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const key = String(spaceKey || 'space').replace(/[^A-Za-z0-9_-]/g, '');
  return ['artup-export', key, rootSlug, date, mode === 'update' ? 'update' : ''].filter(Boolean).join('-') + '.zip';
}
