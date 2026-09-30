import { describe, expect, it } from 'vitest';
import { checkTemplateTags, flattenTags, suggest } from '../../src/core/placeholders.js';

const v = (name) => ({ name, kind: 'value', children: [] });
const raw = (name) => ({ name, kind: 'raw', children: [] });
const loop = (name, ...children) => ({ name, kind: 'loop', children });

describe('checkTemplateTags', () => {
  it('accepts document tags, issue tags and loops in their scopes', () => {
    const tags = [v('jql'), v('summary'), loop('issues', v('key'), raw('description'), loop('comments', v('author'), raw('body'), v('key')), loop('assignee', v('assignee')))];
    expect(checkTemplateTags(tags)).toEqual([]);
  });
  it('suggests the closest tag for a typo', () => {
    expect(checkTemplateTags([loop('issues', v('summry'))])).toEqual([{ kind: 'unknown-tag', tag: 'summry', suggestion: 'summary' }]);
  });
  it('rejects a comment tag outside the comments loop', () => {
    expect(checkTemplateTags([v('body')])).toEqual([{ kind: 'unknown-tag', tag: 'body', suggestion: null }]);
  });
  it('rejects a rich tag on a plain field', () => {
    expect(checkTemplateTags([raw('summary')])).toEqual([{ kind: 'not-rich', tag: 'summary' }]);
  });
  it('checks custom field names against the site fields', () => {
    expect(checkTemplateTags([v('field "Story Points"'), v('field "Storypoints"')], { fieldNames: ['Story Points'] })).toEqual([
      { kind: 'unknown-field', tag: 'field "Storypoints"', suggestion: 'Story Points' },
    ]);
  });
});

describe('checkTemplateTags prototype keys', () => {
  it('flags inherited property names as unknown tags', () => {
    const names = ['constructor', 'toString', '__proto__'];
    const errors = checkTemplateTags(names.map(v));
    expect(errors.map((e) => [e.kind, e.tag])).toEqual(names.map((n) => ['unknown-tag', n]));
  });
  it('flags a rich inherited name without throwing', () => {
    expect(checkTemplateTags([raw('constructor')]).map((e) => e.kind)).toEqual(['unknown-tag']);
  });
});

describe('suggest', () => {
  it('returns the nearest name within two edits, else null', () => {
    expect(suggest('asignee', ['assignee', 'status'])).toBe('assignee');
    expect(suggest('xyz', ['assignee', 'status'])).toBeNull();
  });
});

describe('flattenTags', () => {
  it('lists every tag name at any depth', () => {
    expect(flattenTags([v('jql'), loop('issues', v('key'), loop('comments', raw('body')))])).toEqual(['jql', 'issues', 'key', 'comments', 'body']);
  });
});
