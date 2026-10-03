import { describe, expect, it } from 'vitest';
import { descendantParents, epicOf, nodesFrom, parentIds, unresolvedParents } from '../../src/core/hierarchy.js';

const issue = (id, level, parent) => ({ id, fields: { issuetype: { hierarchyLevel: level }, ...(parent ? { parent: { id: parent[0], fields: { issuetype: { hierarchyLevel: parent[1] } } } } : {}) } });

describe('nodesFrom', () => {
  it('stores each issue and a stub of its parent', () => {
    expect([...nodesFrom([issue('100', -1, ['10', 0])]).values()]).toEqual([
      { id: '100', parentId: '10', level: -1, loaded: true },
      { id: '10', parentId: undefined, level: 0, loaded: false },
    ]);
  });
  it('never replaces a loaded node with a stub', () => {
    const nodes = nodesFrom([issue('10', 0, ['1', 1])]);
    nodesFrom([issue('100', -1, ['10', 0])], nodes);
    expect(nodes.get('10')).toEqual({ id: '10', parentId: '1', level: 0, loaded: true });
  });
  it('takes level 0 when the issue type has no hierarchy level', () => {
    expect([...nodesFrom([{ id: 5, fields: { parent: { id: 6 } } }, { id: 7 }]).values()]).toEqual([
      { id: '5', parentId: '6', level: 0, loaded: true },
      { id: '6', parentId: undefined, level: 0, loaded: false },
      { id: '7', parentId: null, level: 0, loaded: true },
    ]);
  });
});

describe('epicOf', () => {
  it('finds the epic above a story', () => {
    expect(epicOf('10', nodesFrom([issue('10', 0, ['1', 1])]))).toBe('1');
  });
  it('asks for the story before resolving a subtask', () => {
    const nodes = nodesFrom([issue('100', -1, ['10', 0])]);
    expect(epicOf('100', nodes)).toBeUndefined();
    expect(unresolvedParents(['100'], nodes)).toEqual(['10']);
    nodesFrom([issue('10', 0, ['1', 1])], nodes);
    expect(epicOf('100', nodes)).toBe('1');
    expect(unresolvedParents(['100'], nodes)).toEqual([]);
  });
  it('has no epic for an epic, an orphan or an issue under a higher level', () => {
    expect(epicOf('1', nodesFrom([issue('1', 1)]))).toBeNull();
    expect(epicOf('10', nodesFrom([issue('10', 0)]))).toBeNull();
    expect(epicOf('10', nodesFrom([issue('10', 0, ['5', 2])]))).toBeNull();
  });
  it('has no epic for an issue that is not loaded', () => {
    expect(epicOf('404', new Map())).toBeNull();
  });
  it('waits for a parent missing from the nodes', () => {
    expect(epicOf('10', new Map([['10', { id: '10', parentId: '1', level: 0, loaded: true }]]))).toBeUndefined();
  });
  it('gives up on a parent chain longer than 10 levels', () => {
    const nodes = new Map(Array.from({ length: 12 }, (_, i) => [String(i), { id: String(i), parentId: String(i + 1), level: 0, loaded: true }]));
    expect(epicOf('0', nodes)).toBeNull();
  });
});

describe('unresolvedParents', () => {
  it('skips an issue whose missing parent is not even a stub', () => {
    expect(unresolvedParents(['10'], new Map([['10', { id: '10', parentId: '1', level: 0, loaded: true }]]))).toEqual([]);
  });
});

describe('parentIds', () => {
  it('returns the distinct direct parents', () => {
    expect(parentIds(['100', '101', '1'], nodesFrom([issue('100', -1, ['10', 0]), issue('101', -1, ['10', 0]), issue('1', 1)]))).toEqual(['10']);
  });
  it('skips ids that are not loaded', () => {
    expect(parentIds(['404'], new Map())).toEqual([]);
  });
});

describe('descendantParents', () => {
  const tree = new Map([['1', ['10', '11']], ['10', ['100', '101']], ['11', []], ['100', []], ['101', []]]);
  const childrenOf = async (ids) => new Map(ids.map((id) => [id, tree.get(id) ?? []]));
  it('collects the parents whose children are the descendants', async () => {
    expect(await descendantParents(['1'], 10, childrenOf)).toEqual({ parents: ['1', '10'], seen: ['1', '10', '11', '100', '101'] });
  });
  it('stops at the depth', async () => {
    expect(await descendantParents(['1'], 1, childrenOf)).toEqual({ parents: ['1'], seen: ['1', '10', '11'] });
  });
  it('walks a child seen before only once', async () => {
    const loop = new Map([['1', ['2']], ['2', ['1']]]);
    const of = async (ids) => new Map(ids.map((id) => [id, loop.get(id) ?? []]));
    expect(await descendantParents(['1'], 10, of)).toEqual({ parents: ['1', '2'], seen: ['1', '2'] });
  });
});
