import { describe, expect, it } from 'vitest';
import { fitImage, readImageInfo } from '../../src/core/imageSize.js';

function png(width, height) {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpeg(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

describe('readImageInfo', () => {
  it('reads PNG size', () => {
    expect(readImageInfo(png(320, 200))).toEqual({ type: 'png', width: 320, height: 200 });
  });
  it('reads JPEG size from the SOF segment after APP0', () => {
    expect(readImageInfo(jpeg(640, 480))).toEqual({ type: 'jpg', width: 640, height: 480 });
  });
  it('reads GIF size', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00]);
    expect(readImageInfo(gif)).toEqual({ type: 'gif', width: 320, height: 200 });
  });
  it('accepts an ArrayBuffer', () => {
    expect(readImageInfo(png(10, 20).buffer)).toEqual({ type: 'png', width: 10, height: 20 });
  });
  it('returns null for other formats', () => {
    expect(readImageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('fitImage', () => {
  it('keeps an image that already fits', () => {
    expect(fitImage({ width: 300, height: 200 }, 600)).toEqual({ width: 300, height: 200 });
  });
  it('scales a wide image down keeping its ratio', () => {
    expect(fitImage({ width: 1200, height: 600 }, 600)).toEqual({ width: 600, height: 300 });
  });
  it('uses a 16:10 box when the size is unknown', () => {
    expect(fitImage({ width: 0, height: 0 }, 640)).toEqual({ width: 640, height: 400 });
  });
});
