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
  it('clips a colspan that would run into a slot covered from above', () => {
    const grid = tableGrid({ rows: [
      { cells: [c('X'), c('Y', 1, 2)] },
      { cells: [c('Z', 2)] },
    ] });
    expect(grid.map((row) => row.map((s) => (s.origin ? `${s.cell.blocks[0].runs[0].text}${s.colspan}x${s.rowspan}` : `${s.fromAbove ? '^' : '<'}${s.leading ? '!' : ''}`)))).toEqual([
      ['X1x1', 'Y1x2'],
      ['Z1x1', '^!'],
    ]);
  });
  it('gives every covered slot exactly one origin whose spans reach it', () => {
    const grid = tableGrid({ rows: [
      { cells: [c('A', 1, 3), c('B', 2, 1), c('C', 1, 2)] },
      { cells: [c('D', 3, 2)] },
      { cells: [c('E', 4)] },
    ] });
    const owners = grid.map((row) => row.map(() => 0));
    grid.forEach((row, r) => row.forEach((s, col) => {
      if (!s.origin) return;
      for (let dr = 0; dr < s.rowspan; dr += 1) for (let dc = 0; dc < s.colspan; dc += 1) owners[r + dr][col + dc] += 1;
    }));
    expect(owners).toEqual(grid.map((row) => row.map(() => 1)));
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
