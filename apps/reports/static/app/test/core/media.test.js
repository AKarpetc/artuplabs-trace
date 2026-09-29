import { describe, expect, it } from 'vitest';
import { adfToModel } from '../../src/core/adf.js';
import { createMediaResolver } from '../../src/core/media.js';
import fixture from '../fixtures/adf/media-rpt.json';

describe('createMediaResolver', () => {
  const attachments = [{ id: '1', filename: 'a.png' }, { id: '2', filename: 'same.png' }, { id: '3', filename: 'same.png' }];
  it('matches by file name first', () => {
    expect(createMediaResolver(attachments)({ alt: 'a.png' }, 0)).toBe('1');
  });
  it('hands out same-named attachments in order, then reuses the first', () => {
    const resolve = createMediaResolver(attachments);
    expect([resolve({ alt: 'same.png' }, 0), resolve({ alt: 'same.png' }, 1), resolve({ alt: 'same.png' }, 2)]).toEqual(['2', '3', '2']);
  });
  it('falls back to the rendered HTML order', () => {
    const resolve = createMediaResolver(attachments, '<img src="/rest/api/3/attachment/content/3"><img src="/secure/attachment/1/a.png">');
    expect([resolve({ alt: '' }, 0), resolve({ alt: 'unknown' }, 1)]).toEqual(['3', '1']);
  });
  it('never returns an id that is not an attachment of the issue', () => {
    expect(createMediaResolver(attachments, '<img src="/rest/api/3/attachment/content/999">')({ alt: '' }, 0)).toBeNull();
  });
  it('prefers the media-services id in the rendered HTML over the image order', () => {
    const html = '<img src="/rest/api/3/attachment/thumbnail/1" data-media-services-id="u-3"><img data-media-services-id="u-1" src="/rest/api/3/attachment/content/3">';
    const resolve = createMediaResolver(attachments, html);
    expect([resolve({ id: 'u-1' }, 0), resolve({ id: 'u-3' }, 1)]).toEqual(['3', '1']);
  });
  it('gives two distinct images their own ids by order when the HTML has no media-services ids', () => {
    const html = '<img src="/rest/api/3/attachment/content/2"> and <img src="/rest/api/3/attachment/content/1">';
    const resolve = createMediaResolver(attachments, html);
    expect([resolve({ id: 'x' }, 0), resolve({ id: 'y' }, 1)]).toEqual(['2', '1']);
  });
  it('counts one image per img element even when links around it repeat the id', () => {
    const html = '<a href="/rest/api/3/attachment/content/1"><img src="/rest/api/3/attachment/thumbnail/1"></a><img src="/rest/api/3/attachment/content/3">';
    const resolve = createMediaResolver(attachments, html);
    expect([resolve({}, 0), resolve({}, 1)]).toEqual(['1', '3']);
  });
  it.each(fixture.cases.map((c, i) => [i, c]))('maps every media node of live case %i', (_, c) => {
    const resolveMedia = createMediaResolver(c.attachments, c.renderedHtml);
    const ids = adfToModel(c.adf, { resolveMedia }).blocks.flatMap(function collect(b) {
      if (b.type === 'image') return [b.attachmentId];
      return [...(b.blocks ?? []), ...(b.items ?? []).flatMap((i) => i.blocks)].flatMap(collect);
    });
    expect(ids).toEqual(c.expected);
  });
});
