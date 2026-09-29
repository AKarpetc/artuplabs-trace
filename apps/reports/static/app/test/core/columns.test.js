import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { resolveColumn } from '../../src/core/columns.js';

const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string', system: 'summary' } },
  { id: 'customfield_10016', name: 'Story point estimate', custom: true, schema: { type: 'number' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
]);

describe('resolveColumn', () => {
  it('keeps pseudo-columns as they are', () => {
    expect(resolveColumn(catalog, 'worklog.hours')).toEqual({ ref: 'worklog.hours', id: 'worklog.hours', field: null, pseudo: true, missing: false });
  });
  it('resolves a field by name', () => {
    expect(resolveColumn(catalog, 'summary').id).toBe('summary');
  });
  it('resolves story points and sprint by their well-known names and types', () => {
    expect(resolveColumn(catalog, '@storyPoints').id).toBe('customfield_10016');
    expect(resolveColumn(catalog, '@sprint').id).toBe('customfield_10020');
  });
  it('does not resolve inherited property names', () => {
    expect(['constructor', 'toString', '__proto__'].map((ref) => resolveColumn(catalog, ref))).toEqual(
      ['constructor', 'toString', '__proto__'].map((ref) => ({ ref, id: ref, field: null, pseudo: false, missing: true })),
    );
  });
  it('marks a field that is not on the site as missing', () => {
    expect(resolveColumn(catalog, 'customfield_99999')).toEqual({ ref: 'customfield_99999', id: 'customfield_99999', field: null, pseudo: false, missing: true });
  });
});
