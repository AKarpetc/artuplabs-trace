// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WARNING_KINDS, collectMentions, storageToMarkdown } from '../../src/core/convert/index.js';

const ctx = (over = {}) => ({
  siteUrl: 'https://x.atlassian.net',
  resolvePage: ({ title }) => (title === 'Target' ? { id: '9', href: '../api/target.md' } : { id: null, href: `https://x.atlassian.net/wiki/display/ENG/${encodeURIComponent(title)}` }),
  resolveAttachment: (name) => (name === 'missing.png' ? null : `page.assets/${name}`),
  resolveUser: (id) => (id === 'u1' ? 'Анна Ким' : null),
  childLinks: () => [{ title: 'Child A', href: 'page/child-a.md' }],
  ...over,
});
const md = (xhtml, c) => storageToMarkdown(xhtml, ctx(c)).markdown;

describe('blocks', () => {
  it.each([
    ['<h1>Title</h1><p>Text</p>', '# Title\n\nText\n'],
    ['<h3>A <em>b</em></h3>', '### A *b*\n'],
    ['<p>a <strong>b</strong> <em>c</em> <s>d</s> <code>e`f</code></p>', 'a **b** *c* ~~d~~ ``e`f``\n'],
    ['<p>line<br/>next</p>', 'line\\\nnext\n'],
    ['<p># not heading and 1. not list</p>', '\\# not heading and 1. not list\n'],
    ['<p>1. starts like a list</p>', '1\\. starts like a list\n'],
    ['<p>a*b_c [d] &lt;e&gt;</p>', 'a\\*b\\_c \\[d\\] \\<e\\>\n'],
    ['<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>', '- a\n- b\n  - c\n'],
    ['<ol start="3"><li><p>x</p><p>y</p></li><li>z</li></ol>', '3. x\n\n   y\n4. z\n'],
    ['<blockquote><p>q1</p><p>q2</p></blockquote>', '> q1\n>\n> q2\n'],
    ['<hr/>', '---\n'],
    ['<pre>raw *text*</pre>', '```\nraw *text*\n```\n'],
    ['<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>done</ac:task-body></ac:task><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>todo</ac:task-body></ac:task></ac:task-list>', '- [x] done\n- [ ] todo\n'],
    ['<ac:layout><ac:layout-section><ac:layout-cell><p>L</p></ac:layout-cell><ac:layout-cell><p>R</p></ac:layout-cell></ac:layout-section></ac:layout>', 'L\n\nR\n'],
    ['<p>a&nbsp;b &amp; c</p>', 'a b & c\n'],
  ])('%s', (input, expected) => expect(md(input)).toBe(expected));
});

describe('links, images, mentions', () => {
  it('rewrites page links to relative paths and records the target id', () => {
    const result = storageToMarkdown('<p><ac:link><ri:page ri:content-title="Target"/><ac:plain-text-link-body><![CDATA[the target]]></ac:plain-text-link-body></ac:link></p>', ctx());
    expect(result.markdown).toBe('[the target](../api/target.md)\n');
    expect(result.links).toEqual(['9']);
  });
  it('links outside the export go to Confluence', () => {
    expect(md('<p><ac:link><ri:page ri:content-title="Other Page" ri:space-key="HR"/></ac:link></p>')).toBe('[Other Page](https://x.atlassian.net/wiki/display/ENG/Other%20Page)\n');
  });
  it('keeps anchors', () => {
    expect(md('<p><ac:link ac:anchor="setup"><ri:page ri:content-title="Target"/></ac:link></p>')).toBe('[Target](../api/target.md#setup)\n');
  });
  it('rewrites attachment images and links, warns on missing files', () => {
    const result = storageToMarkdown('<p><ac:image ac:alt="Diagram"><ri:attachment ri:filename="d 1.png"/></ac:image> <ac:image><ri:attachment ri:filename="missing.png"/></ac:image></p>', ctx());
    expect(result.markdown).toBe('![Diagram](page.assets/d%201.png) missing.png\n');
    expect(result.attachments).toEqual(['d 1.png']);
    expect(result.warnings).toEqual([{ kind: 'missing-attachment', detail: 'missing.png' }]);
  });
  it('keeps external images and links', () => {
    expect(md('<p><ac:image><ri:url ri:value="https://img.example/a.png"/></ac:image> <a href="https://e.com/a b">site</a></p>')).toBe('![](https://img.example/a.png) [site](https://e.com/a%20b)\n');
  });
  it('turns mentions into @names and warns on unknown users', () => {
    const result = storageToMarkdown('<p><ac:link><ri:user ri:account-id="u1"/></ac:link> and <ac:link><ri:user ri:account-id="u2"/></ac:link></p>', ctx());
    expect(result.markdown).toBe('@Анна Ким and @unknown-user\n');
    expect(result.warnings).toEqual([{ kind: 'unresolved-user', detail: 'u2' }]);
    expect(collectMentions('<ri:user ri:account-id="u1"/><ri:user ri:account-id="u2"/><ri:user ri:account-id="u1"/>')).toEqual(['u1', 'u2']);
  });
});

describe('macros', () => {
  const macro = (name, params, body) => `<ac:structured-macro ac:name="${name}">${Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`).join('')}${body}</ac:structured-macro>`;
  it.each([
    [macro('code', { language: 'js' }, '<ac:plain-text-body><![CDATA[const a = `x`;\n```\n]]></ac:plain-text-body>'), '````js\nconst a = `x`;\n```\n````\n'],
    [macro('noformat', {}, '<ac:plain-text-body><![CDATA[plain]]></ac:plain-text-body>'), '```\nplain\n```\n'],
    [macro('info', { title: 'Heads up' }, '<ac:rich-text-body><p>Body</p></ac:rich-text-body>'), '> [!NOTE]\n> **Heads up**\n> Body\n'],
    [macro('tip', {}, '<ac:rich-text-body><p>T</p></ac:rich-text-body>'), '> [!TIP]\n> T\n'],
    [macro('note', {}, '<ac:rich-text-body><p>N</p></ac:rich-text-body>'), '> [!WARNING]\n> N\n'],
    [macro('warning', {}, '<ac:rich-text-body><p>W</p></ac:rich-text-body>'), '> [!CAUTION]\n> W\n'],
    [macro('panel', { title: 'P' }, '<ac:rich-text-body><p>x</p></ac:rich-text-body>'), '> **P**\n>\n> x\n'],
    [macro('expand', { title: 'More &lt;info&gt;' }, '<ac:rich-text-body><p>hidden</p></ac:rich-text-body>'), '<details>\n<summary>More &lt;info&gt;</summary>\n\nhidden\n\n</details>\n'],
    [`<p>State: ${macro('status', { title: 'In progress', colour: 'Blue' }, '')}</p>`, 'State: `IN PROGRESS`\n'],
    [`<p>${macro('jira', { key: 'ENG-12' }, '')}</p>`, '[ENG-12](https://x.atlassian.net/browse/ENG-12)\n'],
    [`<p>${macro('anchor', { '': 'setup' }, '')}Setup</p>`, '<a id="setup"></a>Setup\n'],
    [macro('children', {}, ''), '- [Child A](page/child-a.md)\n'],
    [macro('excerpt', {}, '<ac:rich-text-body><p>E</p></ac:rich-text-body>'), 'E\n'],
  ])('%s', (input, expected) => expect(md(input)).toBe(expected));

  it('marks dynamic macros and warns', () => {
    const result = storageToMarkdown(macro('toc', {}, ''), ctx());
    expect(result.markdown).toBe('<!-- confluence:toc -->\n');
    expect(result.warnings).toEqual([{ kind: 'dynamic-macro', detail: 'toc' }]);
  });
  it('never drops an unknown macro silently', () => {
    const result = storageToMarkdown(macro('drawio', { diagramName: 'x' }, '<ac:rich-text-body><p>fallback</p></ac:rich-text-body>'), ctx());
    expect(result.markdown).toBe('<!-- confluence:drawio -->\n\nfallback\n');
    expect(result.warnings).toEqual([{ kind: 'unknown-macro', detail: 'drawio' }]);
  });
  it('renders adf-extension fallback content', () => {
    const result = storageToMarkdown('<ac:adf-extension><ac:adf-node type="decision-list"></ac:adf-node><ac:adf-fallback><p>Decided</p></ac:adf-fallback></ac:adf-extension>', ctx());
    expect(result.markdown).toBe('Decided\n');
    expect(result.warnings).toEqual([{ kind: 'adf-extension', detail: 'decision-list' }]);
  });
  it('keeps emoticons', () => {
    expect(md('<p><ac:emoticon ac:name="tick" ac:emoji-fallback="✅"/> ok <ac:emoticon ac:name="warning"/></p>')).toBe('✅ ok ⚠️\n');
  });
});

describe('tables', () => {
  it('writes GFM tables for simple tables, escaping pipes', () => {
    const input = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td><td><p>x</p><p>y</p></td></tr><tr><td>only</td></tr></tbody></table>';
    expect(md(input)).toBe('| A | B |\n| --- | --- |\n| 1 \\| 2 | x<br>y |\n| only |  |\n');
  });
  it('falls back to HTML for merged cells or block content, with a warning', () => {
    const result = storageToMarkdown('<table><tbody><tr><th colspan="2">H</th></tr><tr><td><ul><li>a</li></ul></td><td>b</td></tr></tbody></table>', ctx());
    expect(result.markdown).toBe('<table>\n<tr>\n<th colspan="2">\n\nH\n\n</th>\n</tr>\n<tr>\n<td>\n\n- a\n\n</td>\n<td>\n\nb\n\n</td>\n</tr>\n</table>\n');
    expect(result.warnings).toEqual([{ kind: 'complex-table', detail: '' }]);
  });
});

describe('robustness', () => {
  it('returns a newline-terminated empty document for empty input', () => {
    expect(md('')).toBe('\n');
  });
  it('is deterministic', () => {
    const input = '<p>a</p><table><tbody><tr><th>x</th></tr></tbody></table>';
    expect(md(input)).toBe(md(input));
  });
});

describe('warning kinds', () => {
  it('reports only kinds from the fixed WARNING_KINDS set', () => {
    const macro = (name, params, body) => `<ac:structured-macro ac:name="${name}">${Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`).join('')}${body}</ac:structured-macro>`;
    const inputs = [
      '<p><ac:image><ri:attachment ri:filename="missing.png"/></ac:image></p>',
      '<p><ac:link><ri:user ri:account-id="u2"/></ac:link></p>',
      macro('toc', {}, ''),
      macro('drawio', {}, ''),
      '<ac:adf-extension><ac:adf-node type="x"></ac:adf-node><ac:adf-fallback><p>y</p></ac:adf-fallback></ac:adf-extension>',
      '<table><tbody><tr><th colspan="2">H</th></tr></tbody></table>',
    ];
    const warnings = inputs.flatMap((input) => storageToMarkdown(input, ctx()).warnings);
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) expect(WARNING_KINDS).toContain(warning.kind);
  });
});

describe('fixtures', () => {
  const dir = new URL('../fixtures/storage/', import.meta.url).pathname;
  const names = readdirSync(dir).filter((f) => f.endsWith('.xml')).map((f) => f.replace(/\.xml$/, ''));
  const fixtureCtx = {
    siteUrl: 'https://artuplabs-dev.atlassian.net',
    resolvePage: ({ title }) => ({ id: null, href: `https://artuplabs-dev.atlassian.net/wiki/display/EXPT/${encodeURIComponent(title)}` }),
    resolveAttachment: (name) => `page.assets/${name}`,
    resolveUser: () => null,
    childLinks: () => [],
  };
  it.each(names)('%s', (name) => {
    const xhtml = readFileSync(join(dir, `${name}.xml`), 'utf8');
    const expected = readFileSync(join(dir, `${name}.md`), 'utf8');
    expect(storageToMarkdown(xhtml, fixtureCtx).markdown).toBe(expected);
  });
});
