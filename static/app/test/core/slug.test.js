import { describe, expect, it } from 'vitest';
import { attachmentFileName, toSlug } from '../../src/core/slug.js';

describe('toSlug ascii', () => {
  it.each([
    ['Getting Started', 'getting-started'],
    ['Café Déjà vu', 'cafe-deja-vu'],
    ['Straße', 'strasse'],
    ['Łódź plan', 'lodz-plan'],
    ['Æsir Øresund', 'aesir-oresund'],
    ['Привет, мир!', 'privet-mir'],
    ['Щука и ёж', 'shchuka-i-ezh'],
    ['Йогурт', 'yogurt'],
    ['Київ', 'kiyiv'],
    ['Αθήνα', 'athina'],
    ['API v2.0 (beta)', 'api-v2-0-beta'],
    ['  --Hello__World--  ', 'hello-world'],
    ['ﬁnal Ｐlan', 'final-plan'],
    ['设计文档', ''],
    ['日本語 Guide', 'guide'],
    ['🚀 Launch', 'launch'],
  ])('%s → %s', (title, slug) => expect(toSlug(title)).toBe(slug));

  it('avoids reserved Windows and index names', () => {
    expect(toSlug('CON')).toBe('con-page');
    expect(toSlug('nul')).toBe('nul-page');
    expect(toSlug('Index')).toBe('index-page');
    expect(toSlug('_index')).toBe('index-page');
  });

  it('cuts long titles at a dash, without a trailing dash, within 80 characters', () => {
    const slug = toSlug('word '.repeat(60));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('word-word')).toBe(true);
  });
});

describe('toSlug unicode', () => {
  it('keeps letters of every script, lower-cased, NFC', () => {
    expect(toSlug('设计文档', { fileNames: 'unicode' })).toBe('设计文档');
    expect(toSlug('Привет, Мир!', { fileNames: 'unicode' })).toBe('привет-мир');
    expect(toSlug('Cafe\u0301', { fileNames: 'unicode' })).toBe('café');
  });
  it('stays within 200 UTF-8 bytes', () => {
    const slug = toSlug('漢'.repeat(120), { fileNames: 'unicode' });
    expect(new TextEncoder().encode(slug).length).toBeLessThanOrEqual(200);
  });
  it('keeps combining marks attached to their base letter instead of hyphenating them', () => {
    expect(toSlug('हिन्दी दस्तावेज़', { fileNames: 'unicode' })).toBe('हिन्दी-दस्तावेज़');
  });
  it('keeps a combining mark produced by lower-casing a dotted capital I', () => {
    expect(toSlug('İstanbul', { fileNames: 'unicode' })).not.toContain('-');
  });
});

describe('attachmentFileName', () => {
  it('slugs the base name and keeps a lower-case extension', () => {
    expect(attachmentFileName('Архитектура v2.PNG')).toBe('arkhitektura-v2.png');
    expect(attachmentFileName('report')).toBe('report');
    expect(attachmentFileName('设计.pdf')).toBe('file.pdf');
    expect(attachmentFileName('.env')).toBe('file.env');
  });
});
