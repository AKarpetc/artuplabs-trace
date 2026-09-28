const TABLE = {
  ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u', ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u',
  һ: 'h', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz',
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul', 'index',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);
const MAX_CHARS = 80;
export const MAX_SLUG_BYTES = 200;
const encoder = new TextEncoder();

function transliterate(ch) {
  const direct = TABLE[ch];
  if (direct !== undefined) {
    return direct;
  }
  return [...ch.normalize('NFKD').replace(/\p{M}/gu, '')].map((c) => TABLE[c] ?? c).join('');
}

function trimDashes(text) {
  return text.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function stripLeadingMarks(text) {
  return text.replace(/^\p{M}+/u, '');
}

function cut(slug) {
  const chars = [...slug];
  let end = Math.min(chars.length, MAX_CHARS);
  while (end > 0 && encoder.encode(chars.slice(0, end).join('')).length > MAX_SLUG_BYTES) {
    end -= 1;
  }
  if (end === chars.length) {
    return slug;
  }
  const head = chars.slice(0, end).join('');
  const dash = head.lastIndexOf('-');
  return trimDashes(dash > head.length / 2 ? head.slice(0, dash) : head);
}

/** Lower-case dash-separated slug of a title for file names; '' when nothing usable remains. */
export function toSlug(title, { fileNames = 'ascii' } = {}) {
  const lower = String(title ?? '').normalize('NFC').toLowerCase();
  const mapped = fileNames === 'unicode'
    ? stripLeadingMarks([...lower].map((ch) => (/[\p{L}\p{M}\p{N}]/u.test(ch) ? ch : '-')).join(''))
    : [...lower].map((ch) => transliterate(ch).replace(/[^a-z0-9]/g, '-')).join('');
  const slug = cut(trimDashes(mapped));
  const bare = slug.replace(/^_+/, '');
  return RESERVED.has(bare) ? `${bare}-page` : slug;
}

/** Safe attachment file name: slugged base (or "file") plus the lower-cased extension. */
export function attachmentFileName(title, options = {}) {
  const text = String(title ?? '');
  const dot = text.lastIndexOf('.');
  const hasExt = dot >= 0 && /^[A-Za-z0-9]{1,10}$/.test(text.slice(dot + 1));
  const base = toSlug(hasExt ? text.slice(0, dot) : text, options) || 'file';
  return hasExt ? `${base}.${text.slice(dot + 1).toLowerCase()}` : base;
}
