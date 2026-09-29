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

async function fetchImage(client, id) {
  const full = await attempt(() => client.attachmentBytes(id));
  if (full.bytes || full.status === 404) return full.bytes ?? null;
  return (await attempt(() => client.attachmentThumbnail(id))).bytes ?? null;
}

async function loadImage(client, id) {
  const raw = await fetchImage(client, id);
  if (!raw) return null;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const info = readImageInfo(bytes);
  return info ? { ...info, bytes } : null;
}

/** Downloads each attachment id not yet in the cache once (thumbnail when the file fails other than 404); unreadable images cache as null. */
export async function downloadImages({ client, ids, cache, onProgress }) {
  let done = ids.filter((id) => cache.has(id)).length;
  onProgress({ phase: 'images', done, total: ids.length });
  await Promise.all(ids.filter((id) => !cache.has(id)).map(async (id) => {
    cache.set(id, await loadImage(client, id));
    done += 1;
    onProgress({ phase: 'images', done, total: ids.length });
  }));
  const images = new Map();
  const missing = new Set();
  for (const id of ids) {
    const image = cache.get(id);
    if (image) images.set(id, image);
    else missing.add(id);
  }
  return { images, missing };
}
