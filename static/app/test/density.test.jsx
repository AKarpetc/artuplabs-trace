import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { ChoiceGroup } from '../src/components/ChoiceCard.jsx';
import { PageIcon } from '../src/components/icons.js';
import { I18nProvider, localeDictionaries } from '../src/i18n/index.js';
import { OutputPreview } from '../src/studio/OutputPreview.jsx';
import { ResultView } from '../src/studio/ResultView.jsx';
import { RunningView } from '../src/studio/RunningView.jsx';
import { useExportForm } from '../src/studio/useExportForm.js';

vi.mock('@forge/bridge', () => ({ invoke: vi.fn(), requestConfluence: vi.fn(), view: { close: vi.fn() }, router: { open: vi.fn() } }));

const en = localeDictionaries['en-US'];
const renderIn = (ui) => render(<I18nProvider locale="en-US">{ui}</I18nProvider>);
const RESULT = {
  fileName: 'artup-export-ENG-2026-09-29.zip', mode: 'full', deletePaths: [], warnings: [], fullReason: null, elapsedMs: 4000,
  stats: { written: 3, attachments: 1, bytes: 2048, missing: 0, added: 0, changed: 0, moved: 0, relinked: 0, unchanged: 0 },
};
const OPTIONS = [
  { value: 'a', icon: PageIcon, title: 'Alpha', description: 'First choice', testId: 'c-a' },
  { value: 'b', icon: PageIcon, title: 'Beta', description: 'Second choice', testId: 'c-b' },
];

afterEach(cleanup);

describe('compact density', () => {
  it('ChoiceGroup renders compact cards with titles only and keeps radio semantics', () => {
    renderIn(<ChoiceGroup label="Pick" value="a" options={OPTIONS} onChange={() => {}} compact />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('First choice')).toBeNull();
    expect(screen.getByTestId('c-a')).toHaveAttribute('data-density', 'compact');
  });

  it('ChoiceGroup keeps descriptions at the default density', () => {
    renderIn(<ChoiceGroup label="Pick" value="a" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByText('First choice')).toBeInTheDocument();
    expect(screen.getByTestId('c-a')).not.toHaveAttribute('data-density');
  });

  it('ResultView hides the illustration, lays tiles out 2×2 and adds the extra action when compact', () => {
    renderIn(<ResultView result={RESULT} siteUrl="" spaceKey="ENG" onDownloadAgain={() => {}} onNewExport={() => {}} compact extraAction={<button type="button">Extra</button>} />);
    expect(screen.queryByTestId('result-illustration')).toBeNull();
    expect(screen.getByTestId('result-tiles')).toHaveAttribute('data-columns', '2');
    expect(screen.getByText('Extra')).toBeInTheDocument();
    expect(screen.getByTestId('stat-pages')).toHaveTextContent('3');
  });

  it('ResultView keeps the illustration and fluid tiles by default', () => {
    renderIn(<ResultView result={RESULT} siteUrl="" spaceKey="ENG" onDownloadAgain={() => {}} onNewExport={() => {}} />);
    expect(screen.getByTestId('result-illustration')).toBeInTheDocument();
    expect(screen.getByTestId('result-tiles')).not.toHaveAttribute('data-columns');
  });

  it('RunningView shows a custom hint in place of the tab note', () => {
    renderIn(<RunningView progress={{ stage: 'pages', done: 1, total: 3 }} startedAt={0} onCancel={() => {}} clock={() => 1000} hint="Keep this open" compact />);
    expect(screen.getByText('Keep this open')).toBeInTheDocument();
    expect(screen.queryByText(en['run.keepOpen'])).toBeNull();
    expect(screen.getByTestId('run-view')).toHaveAttribute('data-density', 'compact');
  });

  it('OutputPreview limits the tree and leaves out the front-matter sample when compact', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `docs/p${String(i).padStart(2, '0')}.md`);
    const preview = { status: 'ready', paths, frontMatter: 'title: "A"\n', hiddenExtra: 0, retry: () => {} };
    renderIn(<OutputPreview preview={preview} limit={8} compact />);
    expect(screen.getAllByTestId('file-tree-row').filter((row) => row.dataset.kind === 'markdown')).toHaveLength(8);
    expect(screen.getByTestId('file-tree-more')).toHaveTextContent('+4 more');
    expect(screen.queryByTestId('front-matter')).toBeNull();
  });
});

describe('useExportForm initial target', () => {
  it('starts on a page target when one is given', () => {
    const context = { siteUrl: 'https://x', extension: { space: { key: 'ENG' } } };
    const { result } = renderHook(() => useExportForm(context, { scope: 'page', page: { id: '10', title: null } }));
    expect(result.current.target).toEqual({ kind: 'page', spaceKey: 'ENG', pageId: '10' });
    expect(result.current.ready).toBe(true);
  });
});
