import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PageIcon from '@atlaskit/icon/core/page';
import { I18nProvider } from '../src/i18n/index.js';
import { AppHeader } from '../src/components/AppHeader.jsx';
import { StepSection } from '../src/components/StepSection.jsx';
import { ChoiceCard, ChoiceGroup } from '../src/components/ChoiceCard.jsx';
import { StatTile } from '../src/components/StatTile.jsx';
import { PageLayout } from '../src/components/PageLayout.jsx';
import * as icons from '../src/components/icons.js';
import { glyph } from '../src/components/icons.js';
import { AccessGate } from '../src/app/AccessGate.jsx';
import { invoke } from '@forge/bridge';
import { AppIcon } from '../src/illustrations/AppIcon.jsx';
import { ReportIllustration } from '../src/illustrations/ReportIllustration.jsx';
import { EmptyIllustration } from '../src/illustrations/EmptyIllustration.jsx';
import { LockIllustration } from '../src/illustrations/LockIllustration.jsx';
import { SuccessIllustration } from '../src/illustrations/SuccessIllustration.jsx';

vi.mock('@forge/bridge', () => ({ invoke: vi.fn() }));

const renderIn = (ui, locale = 'en-US') => render(<I18nProvider locale={locale}>{ui}</I18nProvider>);

afterEach(() => {
  cleanup();
  invoke.mockReset();
});

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
    renderIn(<AppHeader subtitle="Reports from Jira" scopeName="RPT" actions={<button type="button">act</button>} />);
    expect(screen.getByRole('heading', { name: 'ArtUp Reports' })).toBeInTheDocument();
    expect(screen.getByText('Reports from Jira')).toBeInTheDocument();
    expect(screen.getByText('RPT')).toBeInTheDocument();
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
    ['AppIcon', AppIcon], ['ReportIllustration', ReportIllustration], ['EmptyIllustration', EmptyIllustration],
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
    const { container } = render(<ReportIllustration />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '120');
  });
});

describe('icons', () => {
  it.each([
    'TableIcon', 'PageIcon', 'FileIcon', 'DownloadIcon', 'UploadIcon', 'DragHandleIcon', 'DeleteIcon', 'EditIcon', 'FilterIcon', 'RefreshIcon',
  ])('%s is a renderable component', (name) => {
    expect(icons[name]).toBeTypeOf('function');
  });
});

describe('AccessGate', () => {
  it('shows a spinner while the licence is checked', () => {
    invoke.mockReturnValue(new Promise(() => {}));
    renderIn(<AccessGate><p>content</p></AccessGate>);
    expect(screen.getByLabelText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('renders its children when licensed', async () => {
    invoke.mockResolvedValue({ licensed: true });
    renderIn(<AccessGate><p>content</p></AccessGate>);
    expect(await screen.findByText('content')).toBeInTheDocument();
  });

  it('shows the lock state with one retry action when unlicensed', async () => {
    invoke.mockResolvedValue({ licensed: false });
    renderIn(<AccessGate><p>content</p></AccessGate>);
    expect(await screen.findByRole('heading', { name: 'ArtUp Reports needs an active license' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: 'Try again' })]);
    expect(screen.queryByText('content')).toBeNull();
  });

  it('checks again on retry and opens once licensed', async () => {
    invoke.mockResolvedValueOnce({ licensed: false }).mockResolvedValueOnce({ licensed: true });
    renderIn(<AccessGate><p>content</p></AccessGate>);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('content')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('shows the failure with a retry action when the check fails', async () => {
    invoke.mockRejectedValue(new Error('boom'));
    renderIn(<AccessGate><p>content</p></AccessGate>);
    expect(await screen.findByText('Something went wrong: boom')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
  });
});
