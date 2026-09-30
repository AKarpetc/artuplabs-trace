import { FIELD_TAG } from '../core/placeholders.js';
import { stripInvalidXml } from './ooxml.js';

/** Placeholder delimiters of customer templates. */
export const DELIMITERS = { start: '{{', end: '}}' };

const TYPOGRAPHIC_QUOTES = /[“”„‟″]/g;

const own = (object, key) => (object !== null && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined);

function ownIgnoringCase(object, key) {
  const exact = own(object, key);
  if (exact !== undefined || object === null || typeof object !== 'object') return exact;
  const match = Object.keys(object).find((k) => k.toLowerCase() === key.toLowerCase());
  return match === undefined ? undefined : object[match];
}

/** Tag name as written, trimmed, with typographic double quotes made straight. */
export function normalizeTag(tag) {
  return String(tag ?? '').trim().replace(TYPOGRAPHIC_QUOTES, '"');
}

/** Docxtemplater parser: `.`, `field "Name"`, dotted paths; a tag rendered as raw XML reads its `__xml` twin. */
export function parseTag(tag) {
  const name = normalizeTag(tag);
  const field = FIELD_TAG.exec(name);
  const path = name === '.' || field ? [] : name.split('.');
  const lookup = (scope, raw) => {
    if (name === '.') return scope;
    if (field) return raw ? undefined : ownIgnoringCase(own(scope, 'fields'), field[1]);
    const last = path.length - 1;
    return path.reduce((value, key, i) => own(value, i === last && raw ? `${key}__xml` : key), scope);
  };
  return {
    get(scope, context) {
      const raw = context?.meta?.part?.module === 'rawxml';
      const value = lookup(scope, raw);
      return typeof value === 'string' && !raw ? stripInvalidXml(value) : value;
    },
  };
}
