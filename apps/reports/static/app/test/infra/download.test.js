import { describe, expect, it, vi } from 'vitest';
import { saveBlob } from '../../src/infra/download.js';

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
