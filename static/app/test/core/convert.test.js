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

describe('fix round 1 (R18/R19)', () => {
  it.each([
    ['ri:url with a link body', '<p><ac:link><ri:url ri:value="https://e.com/p"/><ac:plain-text-link-body><![CDATA[ext]]></ac:plain-text-link-body></ac:link></p>', '[ext](https://e.com/p)\n'],
    ['ri:url without a link body falls back to the URL as text', '<p><ac:link><ri:url ri:value="https://e.com/p"/></ac:link></p>', '[https://e.com/p](https://e.com/p)\n'],
    ['ri:blog-post resolved in the export', '<p><ac:link><ri:blog-post ri:content-title="Target" ri:space-key="ENG"/></ac:link></p>', '[Target](../api/target.md)\n'],
    ['ri:blog-post outside the export goes to Confluence', '<p><ac:link><ri:blog-post ri:content-title="Other Post"/></ac:link></p>', '[Other Post](https://x.atlassian.net/wiki/display/ENG/Other%20Post)\n'],
    ['ri:space', '<p><ac:link><ri:space ri:space-key="ENG"/></ac:link></p>', '[ENG](https://x.atlassian.net/wiki/spaces/ENG)\n'],
    ['ri:content-entity', '<p><ac:link><ri:content-entity ri:content-id="123"/></ac:link></p>', '[123](https://x.atlassian.net/wiki/pages/viewpage.action?pageId=123)\n'],
  ])('1. acLink: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it('1. acLink never renders nothing for an unrecognised target, and warns', () => {
    const result = storageToMarkdown('<p><ac:link></ac:link></p>', ctx());
    expect(result.markdown).toBe('<!-- confluence:ac:link -->\n');
    expect(result.warnings).toEqual([{ kind: 'unknown-macro', detail: 'ac:link' }]);
  });

  it.each([
    ['drops an empty paragraph that holds only a hard break', '<p>a</p><p><br/></p><p>b</p>', 'a\n\nb\n'],
    ['strips a trailing hard break with nothing to break to', '<p>a<br/></p>', 'a\n'],
    ['strips a leading hard break with nothing to break from', '<p><br/>a</p>', 'a\n'],
    ['keeps an interior hard break', '<p>line<br/>next</p>', 'line\\\nnext\n'],
  ])('2. paragraph breaks: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it.each([
    ['punctuation-flanked strong before a word falls back to an HTML tag', '<p><strong>"quoted"</strong>word</p>', '<strong>"quoted"</strong>word\n'],
    ['a word before punctuation-flanked em falls back to an HTML tag', '<p>word<em>(x)</em></p>', 'word<em>(x)</em>\n'],
    ['a link plus trailing period inside strong, followed by a word, falls back to an HTML tag', '<p><strong><a href="u">x</a>.</strong>y</p>', '<strong>[x](u).</strong>y\n'],
    ['adjacent em siblings merge into one run', '<p><em>a</em><em>b</em></p>', '*ab*\n'],
    ['adjacent strong siblings merge into one run', '<p><strong>a</strong><strong>b</strong></p>', '**ab**\n'],
    ['plain alphanumeric strong is unaffected', '<p>a <strong>b</strong> c</p>', 'a **b** c\n'],
  ])('3. emphasis flanking: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it.each([
    ['a block macro inside <p> becomes its own block, the inline run its own paragraph', '<p>see <ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[x]]></ac:plain-text-body></ac:structured-macro></p>', 'see\n\n```\nx\n```\n'],
    ['a panel macro inside <p> splits the surrounding text into separate paragraphs', '<p>before <ac:structured-macro ac:name="info"><ac:rich-text-body><p>in</p></ac:rich-text-body></ac:structured-macro> after</p>', 'before\n\n> [!NOTE]\n> in\n\nafter\n'],
  ])('4. block macro inside <p>: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it('5. a nested task list renders as an indented sub-list, without leaking status text', () => {
    const input = '<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>parent<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>child</ac:task-body></ac:task></ac:task-list></ac:task-body></ac:task></ac:task-list>';
    expect(md(input)).toBe('- [ ] parent\n\n  - [x] child\n');
  });

  it('6. a table-cell link with a "|" in its target and text stays a valid table row', () => {
    expect(md('<table><tbody><tr><td><a href="https://e.com/x|y">l|k</a></td></tr></tbody></table>')).toBe('| [l\\|k](https://e.com/x%7Cy) |\n| --- |\n');
  });

  it.each([
    ['an unknown inline wrapper containing block content becomes a block, keeping paragraphs apart', '<span><p>a</p><p>b</p></span>', 'a\n\nb\n'],
    ['dl renders dt as a bold term and dd as its own paragraph', '<dl><dt>t</dt><dd>d</dd></dl>', '**t**\n\nd\n'],
    ['an unknown wrapper preserves a nested list instead of losing it', '<custom><p>a</p><ul><li>b</li></ul></custom>', 'a\n\n- b\n'],
  ])('7. unknown wrapper elements: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it('8. warns on a missing attachment reached via ac:link, not just ac:image', () => {
    const result = storageToMarkdown('<p><ac:link><ri:attachment ri:filename="missing.png"/></ac:link></p>', ctx());
    expect(result.markdown).toBe('missing.png\n');
    expect(result.warnings).toEqual([{ kind: 'missing-attachment', detail: 'missing.png' }]);
  });

  it('9. escapes "&" before what looks like an HTML/XML entity, so it is not re-decoded downstream', () => {
    expect(md('<p>&amp;copy; &amp;#169;</p>')).toBe('\\&copy; \\&#169;\n');
  });

  it.each([
    ['a thematic-break-looking line after a hard break is escaped', '<p>Title<br/>---</p>', 'Title\\\n\\---\n'],
    ['a setext-heading-looking line ("=") after a hard break is escaped', '<p>Title<br/>===</p>', 'Title\\\n\\===\n'],
    ['a lone run of 3+ asterisks is not read as a thematic break', '<p>***</p>', '\\*\\*\\*\n'],
    ['a "!" right before a link does not turn it into an image', '<p>Wow!<a href="u">x</a></p>', 'Wow\\![x](u)\n'],
    ['a hard break inside a heading becomes a space', '<h2>Title<br/>Sub</h2>', '## Title Sub\n'],
    ['an empty code span renders nothing', '<p><code></code></p>', '\n'],
    ['a newline inside inline code becomes a space, not a line break', '<p>a <code>x\ny</code> b</p>', 'a `x y` b\n'],
    ['an anchor macro with no id renders nothing', '<p><ac:structured-macro ac:name="anchor"></ac:structured-macro>Setup</p>', 'Setup\n'],
    ['ol start="0" keeps 0 instead of defaulting to 1', '<ol start="0"><li>a</li></ol>', '0. a\n'],
    ['paragraph breaks inside a simple table cell still join with <br>', '<table><tbody><tr><td><p>x</p><p>y</p></td></tr></tbody></table>', '| x<br>y |\n| --- |\n'],
  ])('minor: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it('minor: fence() normalises CRLF/CR line endings to LF', () => {
    const macro = (name, params, body) => `<ac:structured-macro ac:name="${name}">${Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`).join('')}${body}</ac:structured-macro>`;
    const input = macro('code', { language: 'js' }, '<ac:plain-text-body><![CDATA[line1\r\nline2\r]]></ac:plain-text-body>');
    expect(md(input)).toBe('```js\nline1\nline2\n```\n');
  });

  it('minor: a macro name is sanitised inside the HTML placeholder comment', () => {
    const result = storageToMarkdown('<ac:structured-macro ac:name="ev-il--&gt;&lt;script&gt;"></ac:structured-macro>', ctx());
    expect(result.markdown).toBe('<!-- confluence:ev-il--script -->\n');
    expect(result.warnings).toEqual([{ kind: 'unknown-macro', detail: 'ev-il--><script>' }]);
  });

  it('minor: legacy <ac:macro> is treated like <ac:structured-macro>', () => {
    const result = storageToMarkdown('<ac:macro ac:name="drawio"><ac:parameter ac:name="diagramName">x</ac:parameter></ac:macro>', ctx());
    expect(result.markdown).toBe('<!-- confluence:drawio -->\n');
    expect(result.warnings).toEqual([{ kind: 'unknown-macro', detail: 'drawio' }]);
  });

  it('every warning produced in this round has a kind in WARNING_KINDS', () => {
    const inputs = [
      '<p><ac:link></ac:link></p>',
      '<p><ac:link><ri:attachment ri:filename="missing.png"/></ac:link></p>',
      '<ac:structured-macro ac:name="ev-il--&gt;&lt;script&gt;"></ac:structured-macro>',
      '<ac:macro ac:name="drawio"><ac:parameter ac:name="diagramName">x</ac:parameter></ac:macro>',
    ];
    const warnings = inputs.flatMap((input) => storageToMarkdown(input, ctx()).warnings);
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) expect(WARNING_KINDS).toContain(warning.kind);
  });
});

describe('fix round 2', () => {
  it('1. deeply nested <span> converts in well under 200ms and keeps the text', () => {
    const input = `<p>${'<span>'.repeat(200)}x${'</span>'.repeat(200)}</p>`;
    const start = performance.now();
    expect(md(input)).toBe('x\n');
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('1. deeply nested <strong> converts in well under 200ms and keeps the text', () => {
    const input = `<p>${'<strong>'.repeat(200)}x${'</strong>'.repeat(200)}</p>`;
    const start = performance.now();
    const result = md(input);
    expect(performance.now() - start).toBeLessThan(200);
    expect(result).toContain('x');
  });

  it.each([
    ['a hard break at the end of a mark moves outside it, not into its core', '<p><strong>a<br/></strong>b</p>', '**a**\\\nb\n'],
    ['a hard break nested inside an inline wrapper at the paragraph edge is still stripped', '<p><span>a<br/></span></p>', 'a\n'],
    ['a hard break before a trailing whitespace-only wrapper is still stripped', '<p>a<br/><span> </span></p>', 'a\n'],
    ['a hard break before a trailing empty mark is still stripped', '<p>a<br/><strong></strong></p>', 'a\n'],
    ['a mark holding only a hard break renders nothing, not stray marks', '<p><strong><br/></strong></p>', '\n'],
  ])('2. edge hard breaks: %s', (name, input, expected) => expect(md(input)).toBe(expected));

  it('3. paragraphs inside a wrapper element in a simple table cell still join with <br>, not a double space', () => {
    expect(md('<table><tbody><tr><td><span><p>x</p><p>y</p></span></td></tr></tbody></table>')).toBe('| x<br>y |\n| --- |\n');
    expect(md('<table><tbody><tr><td><div><p>x</p><p>y</p></div></td></tr></tbody></table>')).toBe('| x<br>y |\n| --- |\n');
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

describe('flavors', () => {
  const macro = (name, params, body) => `<ac:structured-macro ac:name="${name}">${Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`).join('')}${body}</ac:structured-macro>`;
  const rich = (inner) => `<ac:rich-text-body>${inner}</ac:rich-text-body>`;
  const inputs = {
    infoWithTitle: macro('info', { title: 'Heads up' }, rich('<p>Body</p><p>More</p>')),
    warningNoTitle: macro('warning', {}, rich('<p>W</p>')),
    nested: macro('info', {}, rich(`<p>out</p>${macro('tip', { title: 'In' }, rich('<p>in</p>'))}`)),
    unknownMacro: macro('drawio', {}, rich('<p>fallback</p>')),
    dynamicMacro: macro('toc', {}, ''),
    breakInCell: '<table><tbody><tr><th>A</th></tr><tr><td>x<br/>y</td></tr></tbody></table>',
    braces: '<p>a {x} b <code>{y}</code></p><pre>{z}</pre>',
    complexTable: '<table><tbody><tr><th colspan="2">H</th></tr><tr><td rowspan="2"><ul><li>a<br/>b</li></ul></td><td>{b}</td></tr></tbody></table>',
    panel: macro('panel', { title: 'P {1}' }, rich('<p>x</p>')),
  };
  const convert = (flavor) => (key) => storageToMarkdown(inputs[key], ctx(flavor ? { flavor } : {})).markdown;

  it('gfm is the default and matches an explicit gfm flavor', () => {
    for (const key of Object.keys(inputs)) expect(convert('gfm')(key)).toBe(convert(undefined)(key));
    expect(convert('gfm')('infoWithTitle')).toBe('> [!NOTE]\n> **Heads up**\n> Body\n>\n> More\n');
    expect(convert('gfm')('dynamicMacro')).toBe('<!-- confluence:toc -->\n');
  });

  it.each([
    ['infoWithTitle', ':::note[Heads up]\n\nBody\n\nMore\n\n:::\n'],
    ['warningNoTitle', ':::danger\n\nW\n\n:::\n'],
    ['nested', '::::note\n\nout\n\n:::tip[In]\n\nin\n\n:::\n\n::::\n'],
    ['unknownMacro', '{/* confluence:drawio */}\n\nfallback\n'],
    ['dynamicMacro', '{/* confluence:toc */}\n'],
    ['breakInCell', '| A |\n| --- |\n| x<br />y |\n'],
    ['braces', 'a \\{x\\} b `{y}`\n\n```\n{z}\n```\n'],
    ['complexTable', '<table>\n<tbody>\n<tr>\n<th colSpan="2">\n\nH\n\n</th>\n</tr>\n<tr>\n<td rowSpan="2">\n\n- a\\\n  b\n\n</td>\n<td>\n\n\\{b\\}\n\n</td>\n</tr>\n</tbody>\n</table>\n'],
    ['panel', '> **P \\{1\\}**\n>\n> x\n'],
  ])('mdx: %s', (key, expected) => expect(convert('mdx')(key)).toBe(expected));

  it.each([
    ['infoWithTitle', '!!! note "Heads up"\n    Body\n\n    More\n'],
    ['warningNoTitle', '!!! danger\n    W\n'],
    ['nested', '!!! note\n    out\n\n    !!! tip "In"\n        in\n'],
    ['unknownMacro', '<!-- confluence:drawio -->\n\nfallback\n'],
    ['dynamicMacro', '<!-- confluence:toc -->\n'],
    ['breakInCell', '| A |\n| --- |\n| x<br>y |\n'],
    ['braces', 'a \\{x\\} b `{y}`\n\n```\n{z}\n```\n'],
    ['complexTable', '<table markdown="1">\n<tr markdown="1">\n<th colspan="2" markdown="block">\n\nH\n\n</th>\n</tr>\n<tr markdown="1">\n<td rowspan="2" markdown="block">\n\n- a\\\n    b\n\n</td>\n<td markdown="block">\n\n\\{b\\}\n\n</td>\n</tr>\n</table>\n'],
    ['panel', '> **P \\{1\\}**\n>\n> x\n'],
  ])('mkdocs: %s', (key, expected) => expect(convert('mkdocs')(key)).toBe(expected));

  it('mdx keeps admonition kinds for every panel', () => {
    const kinds = ['info', 'tip', 'note', 'warning'].map((name) => storageToMarkdown(macro(name, {}, rich('<p>b</p>')), ctx({ flavor: 'mdx' })).markdown.split('\n')[0]);
    expect(kinds).toEqual([':::note', ':::tip', ':::warning', ':::danger']);
  });

  it('mdx escapes braces in summaries, keeps anchors valid and never emits autolinks', () => {
    const expand = macro('expand', { title: 'a {b} &lt;c&gt;' }, rich('<p>x</p>'));
    expect(md(expand, { flavor: 'mdx' })).toBe('<details>\n<summary>a &#x7B;b&#x7D; &lt;c&gt;</summary>\n\nx\n\n</details>\n');
    expect(md(`<p>${macro('anchor', { '': 'setup' }, '')}Setup</p>`, { flavor: 'mdx' })).toBe('<a id="setup"></a>Setup\n');
    expect(md('<p><a href="https://e.com/a">https://e.com/a</a> <a href="https://e.com/b"></a></p>', { flavor: 'mdx' })).toBe('[https://e.com/a](https://e.com/a) [https://e.com/b](https://e.com/b)\n');
  });

  it('mdx escapes a paragraph line that MDX would read as an import or export', () => {
    expect(md('<p>import data first</p><p>export it<br/>import it</p><p>exported file</p>', { flavor: 'mdx' })).toBe('&#105;mport data first\n\n&#101;xport it\\\n&#105;mport it\n\nexported file\n');
    expect(md('<p>import data first</p>')).toBe('import data first\n');
  });

  it('mdx escapes a paragraph line that Docusaurus would read as a directive fence', () => {
    expect(md('<p>:::note</p><p>::leaf and a:b</p><p>x<br/>:::tip</p>', { flavor: 'mdx' })).toBe('\\:::note\n\n\\::leaf and a:b\n\nx\\\n\\:::tip\n');
    expect(md('<p>:::note</p>')).toBe(':::note\n');
  });

  it('mdx closes the outer fence of a nested admonition with more colons than any inner fence', () => {
    const deep = macro('info', {}, rich(macro('note', {}, rich(macro('tip', {}, rich('<p>x</p>'))))));
    expect(md(deep, { flavor: 'mdx' })).toBe(':::::note\n\n::::warning\n\n:::tip\n\nx\n\n:::\n\n::::\n\n:::::\n');
  });

  it('mkdocs collapses a multi-line title and escapes Markdown in it', () => {
    expect(md(macro('tip', { title: 'a *b*\n c' }, rich('<p>x</p>')), { flavor: 'mkdocs' })).toBe('!!! tip "a \\*b\\* c"\n    x\n');
  });

  it.each([
    ['nested bullets', '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>', '- a\n    - b\n        - c\n- d\n'],
    ['nested ordered', '<ol><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ol>', '1. a\n    1. b\n    2. c\n2. d\n'],
    ['loose ordered items are separated by a blank line', '<ol start="3"><li><p>x</p><p>y</p></li><li>z</li></ol>', '3. x\n\n    y\n\n4. z\n'],
    ['nested task list', '<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>a<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>b</ac:task-body></ac:task></ac:task-list></ac:task-body></ac:task></ac:task-list>', '- [x] a\n\n    - [ ] b\n'],
    ['details parse their Markdown', '<ac:structured-macro ac:name="expand"><ac:rich-text-body><ul><li><strong>x</strong></li></ul></ac:rich-text-body></ac:structured-macro>', '<details markdown="1">\n<summary>Details</summary>\n\n- **x**\n\n</details>\n'],
    ['attribute lists cannot swallow text', '<h2>Title {#id}</h2><p>para {: .x }</p>', '## Title \\{#id\\}\n\npara \\{: .x \\}\n'],
  ])('mkdocs: %s', (name, input, expected) => expect(md(input, { flavor: 'mkdocs' })).toBe(expected));

  it('gfm and mdx keep 2-space nesting, tight ordered lists and plain details', () => {
    const inputs = ['<ul><li>a<ul><li>b</li></ul></li></ul>', '<ol start="3"><li><p>x</p><p>y</p></li><li>z</li></ol>', '<ac:structured-macro ac:name="expand"><ac:rich-text-body><p>x</p></ac:rich-text-body></ac:structured-macro>'];
    const expected = ['- a\n  - b\n', '3. x\n\n   y\n4. z\n', '<details>\n<summary>Details</summary>\n\nx\n\n</details>\n'];
    for (const flavor of ['gfm', 'mdx']) expect(inputs.map((input) => md(input, { flavor }))).toEqual(expected);
  });

  it('same input and flavor give identical output', () => {
    for (const flavor of ['gfm', 'mdx', 'mkdocs']) {
      for (const key of Object.keys(inputs)) expect(convert(flavor)(key)).toBe(convert(flavor)(key));
    }
  });
});
