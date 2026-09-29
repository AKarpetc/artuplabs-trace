const filler = () => ({ origin: true, filler: true, colspan: 1, rowspan: 1, cell: { header: false, colspan: 1, rowspan: 1, blocks: [] } });

/** Places a model table on a rectangular grid: origin slots hold cells, covered slots say where the span came from. */
export function tableGrid(table) {
  const grid = table.rows.map(() => []);
  table.rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c]) c += 1;
      const colspan = Math.max(1, cell.colspan ?? 1);
      const rowspan = Math.max(1, Math.min(cell.rowspan ?? 1, table.rows.length - r));
      for (let dr = 0; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) {
          grid[r + dr][c + dc] = dr === 0 && dc === 0
            ? { origin: true, cell, colspan, rowspan }
            : { origin: false, fromAbove: dr > 0, leading: dc === 0, colspan };
        }
      }
      c += colspan;
    }
  });
  const width = Math.max(1, ...grid.map((row) => row.length));
  return grid.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? filler()));
}
