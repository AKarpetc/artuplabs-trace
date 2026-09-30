const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readJpeg(b) {
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (SOF.has(marker)) {
      return { type: 'jpg', width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

/** Type and pixel size of a PNG, JPEG or GIF; null for anything else. */
export function readImageInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { type: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    return readJpeg(b);
  }
  return null;
}

/** Scales a size down to maxWidth keeping the ratio; unknown sizes get a 16:10 box. */
export function fitImage({ width, height }, maxWidth) {
  if (!(width > 0 && height > 0)) {
    return { width: maxWidth, height: Math.round(maxWidth * 0.625) };
  }
  if (width <= maxWidth) {
    return { width, height };
  }
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

const PNG_SIGNATURE = 8;
const chunkType = (b, i) => String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);

function pngIntact(b) {
  let i = PNG_SIGNATURE;
  let first = true;
  while (i + 12 <= b.length) {
    const length = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = chunkType(b, i);
    if (first && type !== 'IHDR') return false;
    first = false;
    i += 12 + length;
    if (i > b.length) return false;
    if (type === 'IEND') return true;
  }
  return false;
}

function scanStart(b) {
  let i = 2;
  while (i + 4 <= b.length) {
    const marker = b[i + 1];
    if (b[i] !== 0xff || marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const next = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (marker === 0xda) return next;
    i = next;
  }
  return -1;
}

function jpegIntact(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  const start = scanStart(b);
  if (start < 0) return false;
  for (let i = start; i + 1 < b.length; i += 1) {
    if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
  }
  return false;
}

/** Cheap structural check that a PNG or JPEG is complete (PNG chunk walk to IEND, JPEG SOI and an EOI after the first scan, trailers allowed); other types fail. */
export function isImageIntact(bytes, type) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (type === 'png') return b.length > PNG_SIGNATURE && b[0] === 0x89 && b[1] === 0x50 && pngIntact(b);
  if (type === 'jpg' || type === 'jpeg') return jpegIntact(b);
  return false;
}
