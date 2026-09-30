import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BUILTINS, LAYOUTS } from '../../src/core/builtins.js';
import { I18nProvider } from '../../src/i18n/index.js';
import { TemplateThumbnail } from '../../src/wizard/TemplatePicker.jsx';

vi.mock('@forge/bridge', async () => import('../../preview/bridgeMock.js'));

afterEach(cleanup);

const THUMB_WIDTH = 400;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const thumb = (layout) => new Uint8Array(readFileSync(join(process.cwd(), 'preview', 'thumbs', `${layout}.png`)));
const shown = (template) => render(createElement(I18nProvider, { locale: 'en-US' }, createElement(TemplateThumbnail, { template })));

describe('layout thumbnails', () => {
  it.each(LAYOUTS)('has a PNG for the %s layout', (layout) => {
    expect([...thumb(layout).slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it.each(LAYOUTS)('has a %s PNG that is 400 px wide', (layout) => {
    const bytes = thumb(layout);
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(THUMB_WIDTH);
  });

  it.each(BUILTINS.filter((template) => template.kind === 'layout').map((template) => [template.id, template.layout]))('loads thumbs/<layout>.png for %s', (id, layout) => {
    shown(BUILTINS.find((template) => template.id === id));
    expect(screen.getByRole('img')).toHaveAttribute('src', `thumbs/${layout}.png`);
  });

  it('draws the sketch for a template that is not built in', () => {
    shown({ id: 'x', kind: 'layout', layout: 'list', name: 'Mine', format: 'pdf' });
    expect(screen.getByTestId('template-sketch')).toBeInTheDocument();
  });
});
