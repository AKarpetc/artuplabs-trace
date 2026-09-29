import { describe, expect, it } from 'vitest';
import { scriptsIn, splitRuns } from '../../src/core/textRuns.js';

describe('splitRuns', () => {
  it('splits Latin, CJK and Cyrillic and keeps a trailing space with the run before it', () => {
    expect(splitRuns('Report 報告 отчёт')).toEqual([
      { text: 'Report ', script: 'latin' },
      { text: '報告 ', script: 'cjk' },
      { text: 'отчёт', script: 'latin' },
    ]);
  });
  it('gives Hangul its own script', () => {
    expect(splitRuns('한국어 text')).toEqual([
      { text: '한국어 ', script: 'korean' },
      { text: 'text', script: 'latin' },
    ]);
  });
  it('keeps skin-tone modifiers inside the emoji run', () => {
    expect(splitRuns('ok 👍🏽 done')).toEqual([
      { text: 'ok ', script: 'latin' },
      { text: '👍🏽', script: 'emoji' },
      { text: ' done', script: 'latin' },
    ]);
  });
  it('treats kana and CJK extension B as cjk', () => {
    expect(splitRuns('リリース𠀀')).toEqual([{ text: 'リリース𠀀', script: 'cjk' }]);
  });
  it('keeps ©, ® and ™ in the latin run', () => {
    expect(splitRuns('©2026 ™')).toEqual([{ text: '©2026 ™', script: 'latin' }]);
  });
  it('returns no runs for empty or missing text', () => {
    expect(splitRuns('')).toEqual([]);
    expect(splitRuns(null)).toEqual([]);
  });
});

describe('scriptsIn', () => {
  it('collects every script present in the texts', () => {
    expect(scriptsIn(['a', '報', '한'])).toEqual(new Set(['latin', 'cjk', 'korean']));
  });
});
