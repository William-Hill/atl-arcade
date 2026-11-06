// A uniform grid of items on the ground plane (#189), for the neighbor
// search of the walkers: a walker checks the cells near it, not the whole
// pool. Pure: no Three.js here. The items are any objects; the grid keeps
// their cells itself and does not change them.

export function createGrid(cell) {
  return { cell, cells: new Map(), at: new Map() };
}

function key(ix, iz) {
  return ix * 65536 + iz;
}

// Puts `item` in the cell of (x, z), or moves it there. A position that is
// not finite takes the item out.
export function gridSet(grid, item, x, z) {
  const k = Number.isFinite(x) && Number.isFinite(z) ? key(Math.floor(x / grid.cell), Math.floor(z / grid.cell)) : null;
  const old = grid.at.get(item);
  if (old === k) return;
  if (old !== undefined && old !== null) {
    const list = grid.cells.get(old);
    const i = list.indexOf(item);
    list[i] = list[list.length - 1];
    list.pop();
    if (!list.length) grid.cells.delete(old);
  }
  if (k === null) {
    grid.at.delete(item);
    return;
  }
  grid.at.set(item, k);
  let list = grid.cells.get(k);
  if (!list) grid.cells.set(k, (list = []));
  list.push(item);
}

export function gridRemove(grid, item) {
  gridSet(grid, item, NaN, NaN);
}

// Calls fn(item) for each item in the cells that touch the square of half
// size `reach` around (x, z). The caller tests the real distance. When fn
// returns true the search stops, and gridNear returns true.
export function gridNear(grid, x, z, reach, fn) {
  const c = grid.cell;
  const x0 = Math.floor((x - reach) / c);
  const x1 = Math.floor((x + reach) / c);
  const z0 = Math.floor((z - reach) / c);
  const z1 = Math.floor((z + reach) / c);
  for (let a = x0; a <= x1; a += 1) {
    for (let b = z0; b <= z1; b += 1) {
      const list = grid.cells.get(key(a, b));
      if (list) for (let i = 0; i < list.length; i += 1) if (fn(list[i]) === true) return true;
    }
  }
  return false;
}

// A grid of the items of a list, at item.x and item.z.
export function gridOf(items, cell) {
  const grid = createGrid(cell);
  for (const it of items) gridSet(grid, it, it.x, it.z);
  return grid;
}
