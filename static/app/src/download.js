const BOM = '﻿';

/** File name for an export: artup-trace-<kind>-<projectKey>-<YYYY-MM-DD>.csv */
export function csvFileName(kind, projectKey, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const safeKey = String(projectKey || 'project').replace(/[^A-Za-z0-9_-]/g, '');
  return `artup-trace-${kind}-${safeKey}-${date}.csv`;
}

/** Prefixes CSV text with a UTF-8 BOM unless it already carries one. */
export function withBom(text) {
  return text.startsWith(BOM) ? text : `${BOM}${text}`;
}

/** Saves text as a file through a temporary download link (needs a user gesture). */
export function saveTextFile(fileName, text, doc = document) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
