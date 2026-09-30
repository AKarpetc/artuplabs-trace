import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_MAX_BYTES, TEMPLATE_MAX_PARTS, TEMPLATE_PART_BYTES } from '../src/templates/limits.js';

const uiLimits = readFileSync(new URL('../static/app/src/core/limits.js', import.meta.url), 'utf8');

function uiValues(names) {
  return names.reduce((scope, name) => {
    const expression = uiLimits.match(new RegExp(`export const ${name} = ([^;]+);`))[1];
    return { ...scope, [name]: new Function(...Object.keys(scope), `return ${expression};`)(...Object.values(scope)) };
  }, {});
}

describe('template limits', () => {
  it('match the UI limits', () => {
    expect({ TEMPLATE_MAX_BYTES, TEMPLATE_PART_BYTES, TEMPLATE_MAX_PARTS })
      .toEqual(uiValues(['TEMPLATE_MAX_BYTES', 'TEMPLATE_PART_BYTES', 'TEMPLATE_MAX_PARTS']));
  });

  it('are 2 MiB, 150 KiB and 14 parts', () => {
    expect([TEMPLATE_MAX_BYTES, TEMPLATE_PART_BYTES, TEMPLATE_MAX_PARTS]).toEqual([2097152, 153600, 14]);
  });
});
