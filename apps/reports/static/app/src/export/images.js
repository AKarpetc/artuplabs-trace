import { readImageInfo } from '../core/imageSize.js';

const isAbort = (error) => error?.name === 'AbortError';

async function attempt(load) {
  try {
    return { bytes: await load() };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { status: error?.status };
  }
}

async function loadImage(client, id) {
  const full = await attempt(() => client.attachmentBytes(id));
  if (full.status === 404) return { image: null, final: true };
  const raw = full.bytes ?? (await attempt(() => client.attachmentThumbnail(id))).bytes;
  if (!raw) return { image: null, final: false };
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const info = readImageInfo(bytes);
  return { image: info ? { ...info, bytes } : null, final: true };
}

/** Downloads each attachment id not yet cached (thumbnail when the file fails other than 404); a 404 or unreadable image is cached as missing, a transient failure is missing only this time. */
export async function downloadImages({ client, ids, cache, onProgress, signal }) {
  const images = new Map();
  const missing = new Set();
  let done = ids.filter((id) => cache.has(id)).length;
  onProgress({ phase: 'images', done, total: ids.length });
  await Promise.all(ids.filter((id) => !cache.has(id)).map(async (id) => {
    const { image, final } = await loadImage(client, id);
    if (signal?.aborted) return;
    if (final) cache.set(id, image);
    else missing.add(id);
    done += 1;
    onProgress({ phase: 'images', done, total: ids.length });
  }));
  for (const id of ids) {
    const image = cache.get(id);
    if (image) images.set(id, image);
    else missing.add(id);
  }
  return { images, missing };
}
