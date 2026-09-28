import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PageIcon from '@atlaskit/icon/core/page';
import { I18nProvider } from '../src/i18n/index.js';
import { AppHeader } from '../src/components/AppHeader.jsx';
import { StepSection } from '../src/components/StepSection.jsx';
import { ChoiceCard, ChoiceGroup } from '../src/components/ChoiceCard.jsx';
import { StatTile } from '../src/components/StatTile.jsx';
import { FileTree } from '../src/components/FileTree.jsx';
import { PageLayout } from '../src/components/PageLayout.jsx';
import { glyph } from '../src/components/icons.js';
import { AppIcon } from '../src/illustrations/AppIcon.jsx';
import { ExportIllustration } from '../src/illustrations/ExportIllustration.jsx';
import { EmptyIllustration } from '../src/illustrations/EmptyIllustration.jsx';
import { LockIllustration } from '../src/illustrations/LockIllustration.jsx';
import { SuccessIllustration } from '../src/illustrations/SuccessIllustration.jsx';

const renderIn = (ui, locale = 'en-US') => render(<I18nProvider locale={locale}>{ui}</I18nProvider>);

afterEach(cleanup);

function Choices({ onSelect }) {
  const [value, setValue] = useState('space');
  const select = (next) => {
    setValue(next);
    onSelect(next);
  };
  return (
    <div role="radiogroup">
      <ChoiceCard selected={value === 'space'} onSelect={() => select('space')} icon={PageIcon} title="Space" description="All pages" testId="choice-space" />
      <ChoiceCard selected={value === 'tree'} onSelect={() => select('tree')} icon={PageIcon} title="Tree" description="One branch" testId="choice-tree" />
      <ChoiceCard selected={false} onSelect={() => select('off')} icon={PageIcon} title="Off" description="Disabled" disabled testId="choice-off" />
    </div>
  );
}

describe('ChoiceCard', () => {
  it('is a focusable radio that exposes aria-checked', () => {
    renderIn(<Choices onSelect={() => {}} />);
    const space = screen.getByTestId('choice-space');
    expect(space).toHaveAttribute('role', 'radio');
    expect(space).toHaveAttribute('aria-checked', 'true');
    expect(space).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('choice-tree')).toHaveAttribute('aria-checked', 'false');
  });

  it('selects on click', () => {
    const onSelect = vi.fn();
    renderIn(<Choices onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('choice-tree'));
    expect(onSelect).toHaveBeenCalledWith('tree');
    expect(screen.getByTestId('choice-tree')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('choice-space')).toHaveAttribute('aria-checked', 'false');
  });

  it('selects with Space and Enter', () => {
    const onSelect = vi.fn();
    renderIn(<Choices onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByTestId('choice-tree'), { key: ' ' });
    expect(screen.getByTestId('choice-tree')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByTestId('choice-space'), { key: 'Enter' });
    expect(screen.getByTestId('choice-space')).toHaveAttribute('aria-checked', 'true');
    expect(onSelect.mock.calls).toEqual([['tree'], ['space']]);
  });

  it('ignores clicks and keys when disabled', () => {
    const onSelect = vi.fn();
    renderIn(<Choices onSelect={onSelect} />);
    const off = screen.getByTestId('choice-off');
    fireEvent.click(off);
    fireEvent.keyDown(off, { key: ' ' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(off).toHaveAttribute('aria-disabled', 'true');
    expect(off).toHaveAttribute('tabindex', '-1');
  });

  it('shows its badge', () => {
    renderIn(<ChoiceCard selected={false} onSelect={() => {}} icon={PageIcon} title="Hugo" description="d" badge="Recommended" testId="c" />);
    expect(within(screen.getByTestId('c')).getByText('Recommended')).toBeInTheDocument();
  });
});

const OPTIONS = [
  { value: 'gfm', icon: PageIcon, title: 'GFM', description: 'd', testId: 'g-gfm' },
  { value: 'docusaurus', icon: PageIcon, title: 'Docusaurus', description: 'd', testId: 'g-docusaurus' },
  { value: 'hugo', icon: PageIcon, title: 'Hugo', description: 'd', disabled: true, testId: 'g-hugo' },
  { value: 'mkdocs', icon: PageIcon, title: 'MkDocs', description: 'd', testId: 'g-mkdocs' },
];

function Group({ initial = 'gfm', onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return <ChoiceGroup label="Format" value={value} options={OPTIONS} onChange={(next) => { setValue(next); onChange(next); }} />;
}

describe('ChoiceGroup', () => {
  const tabStops = () => screen.getAllByRole('radio').filter((radio) => radio.getAttribute('tabindex') === '0');

  it('is a labelled radiogroup with a single tab stop on the selected card', () => {
    renderIn(<Group initial="docusaurus" />);
    expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
    expect(tabStops()).toEqual([screen.getByTestId('g-docusaurus')]);
    expect(screen.getByTestId('g-hugo')).toHaveAttribute('tabindex', '-1');
  });

  it('puts the tab stop on the first enabled card when nothing is selected', () => {
    renderIn(<ChoiceGroup label="Format" value={null} options={OPTIONS} onChange={() => {}} />);
    expect(tabStops()).toEqual([screen.getByTestId('g-gfm')]);
  });

  it('moves selection and focus with arrows, skipping disabled cards and wrapping', () => {
    const onChange = vi.fn();
    renderIn(<Group onChange={onChange} />);
    const gfm = screen.getByTestId('g-gfm');
    gfm.focus();
    fireEvent.keyDown(gfm, { key: 'ArrowRight' });
    expect(screen.getByTestId('g-docusaurus')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('g-docusaurus')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('g-docusaurus'), { key: 'ArrowDown' });
    expect(screen.getByTestId('g-mkdocs')).toHaveFocus();
    expect(screen.getByTestId('g-hugo')).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(screen.getByTestId('g-mkdocs'), { key: 'ArrowRight' });
    expect(gfm).toHaveFocus();
    fireEvent.keyDown(gfm, { key: 'ArrowLeft' });
    expect(screen.getByTestId('g-mkdocs')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('g-mkdocs'), { key: 'ArrowUp' });
    expect(screen.getByTestId('g-docusaurus')).toHaveFocus();
    expect(onChange.mock.calls).toEqual([['docusaurus'], ['mkdocs'], ['gfm'], ['mkdocs'], ['docusaurus']]);
    expect(tabStops()).toEqual([screen.getByTestId('g-docusaurus')]);
  });

  it('jumps to the first and last enabled card with Home and End', () => {
    renderIn(<Group initial="docusaurus" />);
    fireEvent.keyDown(screen.getByTestId('g-docusaurus'), { key: 'End' });
    expect(screen.getByTestId('g-mkdocs')).toHaveFocus();
    expect(screen.getByTestId('g-mkdocs')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByTestId('g-mkdocs'), { key: 'Home' });
    expect(screen.getByTestId('g-gfm')).toHaveFocus();
    expect(screen.getByTestId('g-gfm')).toHaveAttribute('aria-checked', 'true');
  });

  it('selects by click through the group', () => {
    renderIn(<Group />);
    fireEvent.click(screen.getByTestId('g-mkdocs'));
    expect(screen.getByTestId('g-mkdocs')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('g-hugo'));
    expect(screen.getByTestId('g-hugo')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('FileTree', () => {
  const names = () => screen.getAllByTestId('file-tree-row').map((row) => row.textContent);

  it('renders nested folders as rows, folders first', () => {
    renderIn(<FileTree paths={['a/index.md', 'a/b.md', 'c.md']} />);
    expect(names()).toEqual(['a', 'b.md', 'index.md', 'c.md']);
    const rows = screen.getAllByTestId('file-tree-row');
    expect(rows.map((row) => row.getAttribute('data-depth'))).toEqual(['0', '1', '1', '0']);
    const list = screen.getByRole('list', { name: 'Files in the export' });
    const nested = within(list).getAllByRole('list');
    expect(nested).toHaveLength(1);
    expect(within(nested[0]).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['b.md', 'index.md']);
    expect(rows[0]).toHaveAttribute('data-kind', 'folder');
    expect(rows[1]).toHaveAttribute('data-kind', 'markdown');
  });

  it('marks attachments differently from Markdown files', () => {
    renderIn(<FileTree paths={['a/b.md', 'a/b.assets/d.png']} />);
    const kinds = screen.getAllByTestId('file-tree-row').map((row) => row.getAttribute('data-kind'));
    expect(kinds).toEqual(['folder', 'folder', 'attachment', 'markdown']);
  });

  it('shows a +N more row from moreLabel when the limit is exceeded', () => {
    renderIn(<FileTree paths={['a/index.md', 'a/b.md', 'c.md']} limit={1} moreLabel={(count) => `+${count} more`} />);
    expect(names()).toEqual(['a', 'b.md']);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('accepts a plain string moreLabel and falls back to a translated one', () => {
    renderIn(<FileTree paths={['a.md', 'b.md', 'c.md']} limit={2} moreLabel="and others" />);
    expect(screen.getByText('and others')).toBeInTheDocument();
    cleanup();
    renderIn(<FileTree paths={['a.md', 'b.md', 'c.md']} limit={1} />, 'ru-RU');
    expect(screen.getByText('Ещё 2 файла')).toBeInTheDocument();
  });

  it('has no more row within the limit and a translated tree label', () => {
    renderIn(<FileTree paths={['a.md']} />);
    expect(screen.queryByTestId('file-tree-more')).toBeNull();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('treeitem')).toBeNull();
    expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'Files in the export');
  });
});

describe('StatTile', () => {
  it('renders label and value', () => {
    renderIn(<StatTile label="Pages" value="60" tone="success" icon={PageIcon} />);
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });
});

describe('PageLayout', () => {
  it('renders both slots', () => {
    renderIn(<PageLayout main={<p>main-slot</p>} aside={<p>aside-slot</p>} />);
    expect(screen.getByText('main-slot')).toBeInTheDocument();
    expect(screen.getByText('aside-slot')).toBeInTheDocument();
  });

  it('renders without an aside', () => {
    renderIn(<PageLayout main={<p>main-only</p>} />);
    expect(screen.getByText('main-only')).toBeInTheDocument();
  });
});

describe('StepSection', () => {
  it('renders the number, title, description and content', () => {
    renderIn(<StepSection number={2} title="Choose a format" description="Pick a preset"><p>body</p></StepSection>);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a format' })).toBeInTheDocument();
    expect(screen.getByText('Pick a preset')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});

describe('AppHeader', () => {
  it('renders the app name, subtitle, space and actions', () => {
    renderIn(<AppHeader subtitle="Git-ready" spaceName="Engineering" actions={<button type="button">act</button>} />);
    expect(screen.getByRole('heading', { name: 'ArtUp Export' })).toBeInTheDocument();
    expect(screen.getByText('Git-ready')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument();
  });
});

describe('glyph', () => {
  it('unwraps a CommonJS icon module and passes a component through', () => {
    const Icon = () => null;
    expect(glyph({ default: Icon })).toBe(Icon);
    expect(glyph(Icon)).toBe(Icon);
    expect(glyph(undefined)).toBeUndefined();
  });

  it('lets cards take an icon module object as the bundler delivers it', () => {
    renderIn(<StatTile label="Pages" value="1" icon={{ default: PageIcon }} />);
    expect(screen.getByText('Pages')).toBeInTheDocument();
  });
});

describe('illustrations', () => {
  it.each([
    ['AppIcon', AppIcon], ['ExportIllustration', ExportIllustration], ['EmptyIllustration', EmptyIllustration],
    ['LockIllustration', LockIllustration], ['SuccessIllustration', SuccessIllustration],
  ])('%s renders a decorative svg with no text', (name, Illustration) => {
    const { container } = render(<Illustration size={96} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('width', '96');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('text')).toBeNull();
  });

  it('defaults to 120px', () => {
    const { container } = render(<ExportIllustration />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '120');
  });
});
