import { describe, expect, it, vi } from 'vitest';
import { exportFileName, saveBlob } from '../../src/infra/download.js';

describe('exportFileName', () => {
  it('builds artup-export-<space>-<root>-<date>-update for an update export', () => {
    const now = new Date(2026, 8, 28);
    expect(exportFileName({ spaceKey: 'ENG', rootSlug: 'api', mode: 'update', now })).toBe('artup-export-ENG-api-2026-09-28-update.zip');
  });

  it('omits the -update suffix for a full export', () => {
    const now = new Date(2026, 8, 28);
    expect(exportFileName({ spaceKey: 'ENG', rootSlug: 'api', mode: 'full', now })).toBe('artup-export-ENG-api-2026-09-28.zip');
  });

  it('omits the root slug when there is none', () => {
    const now = new Date(2026, 0, 1);
    expect(exportFileName({ spaceKey: 'ENG', rootSlug: null, mode: 'full', now })).toBe('artup-export-ENG-2026-01-01.zip');
  });

  it('falls back to "space" and strips unsafe characters from the space key', () => {
    const now = new Date(2026, 8, 28);
    expect(exportFileName({ spaceKey: '', rootSlug: null, mode: 'full', now })).toBe('artup-export-space-2026-09-28.zip');
    expect(exportFileName({ spaceKey: 'EN G/1!', rootSlug: null, mode: 'full', now })).toBe('artup-export-ENG1-2026-09-28.zip');
  });
});

describe('saveBlob', () => {
  it('creates a download anchor, clicks it, and revokes the object URL later', () => {
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

    const blob = new Blob(['zip-bytes'], { type: 'application/zip' });
    saveBlob('artup-export-ENG-2026-09-28.zip', blob, doc);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe('artup-export-ENG-2026-09-28.zip');
    expect(clicked).toBe(true);

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    vi.useRealTimers();
  });
});
