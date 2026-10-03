import { shippedFunctions } from '../src/core/catalog.js';

/** Forge function key of a JQL function: `fn-` and the first three letters of each word of its module key (Forge allows 23 characters). */
const functionKey = (f) => `fn-${f.key.split('-').map((w) => w.slice(0, 3)).join('-')}`;

const lines = ['  jira:jqlFunction:'];
for (const f of shippedFunctions()) {
  lines.push(`    - key: ${f.key}`, `      name: ${f.name}`, '      arguments:');
  for (const a of [...f.args, { name: 'page', required: false }]) lines.push(`        - name: ${a.name}`, `          required: ${a.required}`);
  lines.push('      types:', '        - issue', '      operators:', '        - in', '        - not in', `      function: ${functionKey(f)}`);
}
lines.push('', '  function: (append to the existing list)');
for (const f of shippedFunctions()) lines.push(`    - key: ${functionKey(f)}`, `      handler: index.${f.name}`);
console.log(lines.join('\n'));
