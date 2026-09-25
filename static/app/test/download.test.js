import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { invoke } from '@forge/bridge';
import { csvFileName, saveTextFile, withBom } from '../src/download.js';
import { ExportButton } from '../src/components/ExportButton.jsx';
import { I18nProvider } from '../src/i18n/index.js';
import { ToastProvider } from '../src/components/Toasts.jsx';

vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  router: { navigate: vi.fn() },
}));

function renderExportButton(props) {
  return render(
    createElement(
      I18nProvider,
      { locale: 'en-US' },
      createElement(ToastProvider, null, createElement(ExportButton, props)),
    ),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('csvFileName', () => {
  it('builds the artup-trace-<kind>-<projectKey>-<date> name', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(csvFileName('coverage', 'REQ', now)).toBe('artup-trace-coverage-REQ-2026-09-25.csv');
  });

  it('strips characters outside A-Za-z0-9_- from the project key', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(csvFileName('suspects', 'RE Q/1!', now)).toBe('artup-trace-suspects-REQ1-2026-09-25.csv');
  });

  it('falls back to "project" when the project key is missing', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(csvFileName('baseline-diff', '', now)).toBe('artup-trace-baseline-diff-project-2026-09-25.csv');
  });
});

describe('withBom', () => {
  it('prepends a BOM when the text does not start with one', () => {
    expect(withBom('a,b\n1,2\n')).toBe('﻿a,b\n1,2\n');
  });

  it('leaves text that already starts with a BOM unchanged', () => {
    const withExisting = '﻿a,b\n1,2\n';
    expect(withBom(withExisting)).toBe(withExisting);
  });
});

describe('saveTextFile', () => {
  it('creates a download anchor, clicks it, and revokes the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;

    let clicked = false;
    const anchor = document.createElement('a');
    anchor.click = () => {
      clicked = true;
    };
    const doc = {
      createElement: vi.fn(() => anchor),
      body: document.body,
    };

    saveTextFile('artup-trace-coverage-REQ-2026-09-25.csv', 'a,b\n1,2\n', doc);

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBe('artup-trace-coverage-REQ-2026-09-25.csv');
    expect(clicked).toBe(true);

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    vi.useRealTimers();
  });
});

describe('ExportButton', () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('saves a file even when the export has 0 rows', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = vi.fn();
    invoke.mockResolvedValue({ csv: '﻿Requirement,Summary,Status\n', truncated: false });

    renderExportButton({ kind: 'gaps', projectKey: 'REQ', payload: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('exportCsv', { kind: 'gaps' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(await screen.findByText('File artup-trace-coverage-REQ-2026-09-25.csv downloaded')).toBeInTheDocument();
  });

  it('prepends a BOM defensively when the resolver result is missing one', async () => {
    const OriginalBlob = global.Blob;
    const parts = [];
    function RecordingBlob(blobParts, options) {
      parts.push(blobParts[0]);
      return new OriginalBlob(blobParts, options);
    }
    global.Blob = RecordingBlob;
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    invoke.mockResolvedValue({ csv: 'Requirement,Summary,Status\n', truncated: false });

    try {
      renderExportButton({ kind: 'gaps', projectKey: 'REQ', payload: {} });
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

      await waitFor(() => expect(parts).toHaveLength(1));
      expect(parts[0].startsWith('﻿')).toBe(true);
    } finally {
      global.Blob = OriginalBlob;
    }
  });

  it('shows a success toast and a truncation warning when the export was truncated', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    invoke.mockResolvedValue({ csv: '﻿Requirement,Summary,Status\n', truncated: true });

    renderExportButton({ kind: 'suspects', projectKey: 'REQ', payload: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('File artup-trace-suspects-REQ-2026-09-25.csv downloaded')).toBeInTheDocument();
    expect(await screen.findByText('Only the first 5 000 rows were exported.')).toBeInTheDocument();
  });

  it('sends the baseline-diff payload and file-name kind for kind="diff"', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    invoke.mockResolvedValue({ csv: '﻿Requirement,Summary,Change\n', truncated: false });

    renderExportButton({ kind: 'diff', projectKey: 'REQ', payload: { leftId: '1', rightId: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('exportCsv', { leftId: '1', rightId: '2', kind: 'diff' }));
    expect(await screen.findByText('File artup-trace-baseline-diff-REQ-2026-09-25.csv downloaded')).toBeInTheDocument();
  });

  it('shows an error toast and saves no file when the resolver call fails', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = vi.fn();
    invoke.mockRejectedValue(new Error('no-permission'));

    renderExportButton({ kind: 'gaps', projectKey: 'REQ', payload: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('You do not have permission for this action in this project.')).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('disables the button while the export is in flight so a double click cannot fire twice', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    let resolveInvoke;
    invoke.mockReturnValue(new Promise((resolve) => {
      resolveInvoke = resolve;
    }));

    renderExportButton({ kind: 'gaps', projectKey: 'REQ', payload: {} });
    const button = screen.getByRole('button', { name: 'Export CSV' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(invoke).toHaveBeenCalledTimes(1);

    resolveInvoke({ csv: '﻿Requirement,Summary,Status\n', truncated: false });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
