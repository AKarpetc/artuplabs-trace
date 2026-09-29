import { describe, expect, it } from 'vitest';
import { tableGrid } from '../../src/core/tableGrid.js';

const c = (name, colspan = 1, rowspan = 1) => ({ header: false, colspan, rowspan, blocks: [{ type: 'para', runs: [{ text: name }] }] });

describe('tableGrid', () => {
  it('places colspan and rowspan cells and marks covered slots', () => {
    const grid = tableGrid({ rows: [
      { cells: [c('A', 2), c('B', 1, 2)] },
      { cells: [c('C'), c('D')] },
    ] });
    expect(grid.map((row) => row.map((s) => (s.origin ? s.cell.blocks[0].runs[0].text : `${s.fromAbove ? '^' : '<'}${s.leading ? '!' : ''}`)))).toEqual([
      ['A', '<', 'B'],
      ['C', 'D', '^!'],
    ]);
  });
  it('fills short rows with empty filler cells', () => {
    const grid = tableGrid({ rows: [{ cells: [c('A'), c('B')] }, { cells: [c('C')] }] });
    expect(grid[1][1]).toEqual({ origin: true, filler: true, colspan: 1, rowspan: 1, cell: { header: false, colspan: 1, rowspan: 1, blocks: [] } });
  });
  it('clips a rowspan that runs past the last row', () => {
    const grid = tableGrid({ rows: [{ cells: [c('A', 1, 5)] }] });
    expect(grid).toHaveLength(1);
    expect(grid[0][0].rowspan).toBe(1);
  });
});
