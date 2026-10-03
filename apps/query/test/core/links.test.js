import { describe, expect, it } from 'vitest';
import { closure, hasLinksJql, linkedIds, linkQuery, matchLinkType } from '../../src/core/links.js';

const TYPES = [
  { id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
  { id: '2', name: 'Relates', outward: 'relates to', inward: 'relates to' },
  { id: '3', name: 'Cloners', outward: 'clones', inward: 'is cloned by' },
];
const out = (typeId, id) => ({ type: { id: typeId }, outwardIssue: { id } });
const inw = (typeId, id) => ({ type: { id: typeId }, inwardIssue: { id } });

describe('matchLinkType', () => {
  it('reads a type name as both directions', () => {
    expect(matchLinkType(TYPES, ' blocks ')).toEqual({ filter: { typeId: '1', direction: 'outward' } });
    expect(matchLinkType(TYPES, 'Blocks')).toEqual({ filter: { typeId: '1', direction: 'any' } });
  });
  it('reads a direction description as that direction', () => {
    expect(matchLinkType(TYPES, 'is blocked by')).toEqual({ filter: { typeId: '1', direction: 'inward' } });
  });
  it('treats a symmetric description as both directions', () => {
    expect(matchLinkType(TYPES, 'relates to')).toEqual({ filter: { typeId: '2', direction: 'any' } });
  });
  it('means every link when no type is given', () => {
    expect(matchLinkType(TYPES, undefined)).toEqual({ filter: null });
  });
  it('names an unknown type', () => {
    expect(matchLinkType(TYPES, 'duplicates')).toEqual({ error: 'Link type "duplicates" not found', log: 'Link type not found' });
  });
  it('refuses a description shared by two types', () => {
    expect(matchLinkType([...TYPES, { id: '9', name: 'Gates', outward: 'blocks', inward: 'is gated by' }], 'blocks')).toEqual({ error: 'Link type "blocks" matches 2 items; use its id', log: 'Link type is ambiguous' });
  });
  it('reads a type name in any case as both directions when no description matches', () => {
    expect(matchLinkType(TYPES, 'CLONERS')).toEqual({ filter: { typeId: '3', direction: 'any' } });
  });
  it('refuses a name shared by two types in different case', () => {
    expect(matchLinkType([{ id: '1', name: 'Gate', outward: 'a', inward: 'b' }, { id: '2', name: 'GATE', outward: 'c', inward: 'd' }], 'gate')).toEqual({ error: 'Link type "gate" matches 2 items; use its id', log: 'Link type is ambiguous' });
  });
});

describe('linkedIds', () => {
  const links = [out('1', '10'), inw('1', '11'), out('2', '12'), { type: { id: '1' } }];
  it('returns every other end without a filter', () => {
    expect(linkedIds(links, null)).toEqual(['10', '11', '12']);
  });
  it('keeps one type and direction', () => {
    expect(linkedIds(links, { typeId: '1', direction: 'outward' })).toEqual(['10']);
    expect(linkedIds(links, { typeId: '1', direction: 'inward' })).toEqual(['11']);
    expect(linkedIds(links, { typeId: '1', direction: 'any' })).toEqual(['10', '11']);
  });
  it('returns nothing for an issue without links', () => {
    expect(linkedIds(undefined, null)).toEqual([]);
  });
});

describe('hasLinksJql', () => {
  it('uses the native issueLinkType clause', () => {
    expect(hasLinksJql(TYPES, null)).toBe('issueLinkType is not EMPTY');
    expect(hasLinksJql(TYPES, { typeId: '1', direction: 'outward' })).toBe('issueLinkType = "blocks"');
    expect(hasLinksJql(TYPES, { typeId: '1', direction: 'any' })).toBe('issueLinkType in ("blocks", "is blocked by")');
    expect(hasLinksJql(TYPES, { typeId: '2', direction: 'any' })).toBe('issueLinkType = "relates to"');
  });
  it('quotes the inward description for an inward filter', () => {
    expect(hasLinksJql(TYPES, { typeId: '3', direction: 'inward' })).toBe('issueLinkType = "is cloned by"');
  });
});

describe('linkQuery', () => {
  it('asks Jira for every link without a filter', () => {
    expect(linkQuery(TYPES, null)).toEqual({ native: 'issueLinkType is not EMPTY' });
  });
  it('asks Jira for both directions of a type', () => {
    expect(linkQuery(TYPES, { typeId: '1', direction: 'any' })).toEqual({ native: 'issueLinkType in ("blocks", "is blocked by")' });
  });
  it('asks Jira for a direction whose description is no type name', () => {
    expect(linkQuery(TYPES, { typeId: '1', direction: 'inward' })).toEqual({ native: 'issueLinkType = "is blocked by"' });
    expect(linkQuery(TYPES, { typeId: '3', direction: 'outward' })).toEqual({ native: 'issueLinkType = "clones"' });
  });
  it('computes a direction whose description equals a type name in any case', () => {
    expect(linkQuery(TYPES, { typeId: '1', direction: 'outward' })).toEqual({ compute: { typeId: '1', direction: 'outward' } });
  });
  it('computes a direction whose description is another type name', () => {
    const types = [...TYPES, { id: '4', name: 'Is Cloned By', outward: 'x', inward: 'y' }];
    expect(linkQuery(types, { typeId: '3', direction: 'inward' })).toEqual({ compute: { typeId: '3', direction: 'inward' } });
  });
  it('computes a direction of a symmetric type', () => {
    expect(linkQuery(TYPES, { typeId: '2', direction: 'outward' })).toEqual({ compute: { typeId: '2', direction: 'outward' } });
  });
  it('computes both directions when a description belongs to another type too', () => {
    const types = [...TYPES, { id: '9', name: 'Gates', outward: 'blocks', inward: 'is gated by' }];
    expect(linkQuery(types, { typeId: '1', direction: 'any' })).toEqual({ compute: { typeId: '1', direction: 'any' } });
  });
});

describe('closure', () => {
  const graph = new Map([['1', ['2']], ['2', ['3', '1']], ['3', ['4']], ['4', ['3']]]);
  const neighboursOf = async (ids) => new Map(ids.map((id) => [id, graph.get(id) ?? []]));
  it('walks links level by level and survives cycles', async () => {
    expect(await closure(['1'], 10, neighboursOf)).toEqual(['1', '2', '3', '4']);
  });
  it('stops at the given depth', async () => {
    expect(await closure(['1'], 2, neighboursOf)).toEqual(['1', '2', '3']);
    expect(await closure(['1'], 1, neighboursOf)).toEqual(['2']);
  });
  it('caps the depth at 10 levels', async () => {
    const chain = async (ids) => new Map(ids.map((id) => [id, [String(Number(id) + 1)]]));
    expect(await closure(['0'], 50, chain)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
  it('treats an id missing from the answer as having no links', async () => {
    expect(await closure(['1'], 3, async () => new Map())).toEqual([]);
  });
});
