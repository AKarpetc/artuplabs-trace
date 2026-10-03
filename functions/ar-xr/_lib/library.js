// Прокси библиотеки моделей /ar-xr/library/*: R2 первым, при промахе — Yandex-origin
// с записью в R2 в фоне (context.waitUntil).

import { HttpError, problem } from './http.js';
import { MANIFEST_PATH } from './catalog.js';
import { keys } from './store.js';

export const LIBRARY_BASE = '/ar-xr/library/';
export const ORIGIN = 'https://models-for-demo.website.yandexcloud.net/library/';
export const MAX_WRITE_THROUGH_BYTES = 95 * 1024 * 1024;
const CACHE_CONTROL = 'public, max-age=86400';
const MANIFEST_CACHE_CONTROL = 'public, max-age=300';

const CONTENT_TYPES = {
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    usdz: 'model/vnd.usdz+zip',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ktx2: 'image/ktx2',
    json: 'application/json',
    bin: 'application/octet-stream'
};

export function contentTypeFor(path, fallback = 'application/octet-stream') {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    return (ext && CONTENT_TYPES[ext]) ?? fallback;
}

/** Путь внутри библиотеки или HttpError(400/404). */
export function libraryPath(pathname) {
    if (!pathname.startsWith(LIBRARY_BASE))
        throw new HttpError(404, 'Не найдено.');
    const raw = pathname.slice(LIBRARY_BASE.length);
    let path;
    try {
        path = decodeURIComponent(raw);
    }
    catch {
        throw new HttpError(400, 'Некорректный путь.');
    }
    if (path === '')
        throw new HttpError(404, 'Не найдено.');
    const parts = path.split('/');
    if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || path.startsWith('/')
        || parts.some(p => p === '..' || p === '.' || p === ''))
        throw new HttpError(400, 'Некорректный путь.');
    return path;
}

function originUrl(path) {
    return ORIGIN + path.split('/').map(encodeURIComponent).join('/');
}

/** Собирает body для R2.put: FixedLengthStream в Workers, иначе буфер (с лимитом). */
async function writeThrough(bucket, key, stream, length, contentType) {
    const options = { httpMetadata: { contentType } };
    if (Number.isFinite(length) && typeof globalThis.FixedLengthStream === 'function') {
        const fixed = new globalThis.FixedLengthStream(length);
        const pipe = stream.pipeTo(fixed.writable);
        await Promise.all([bucket.put(key, fixed.readable, options), pipe]);
        return;
    }
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > MAX_WRITE_THROUGH_BYTES) {
            await reader.cancel().catch(() => {});
            return;
        }
        chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
    }
    await bucket.put(key, buf, options);
}

/**
 * @param {Request} request
 * @param {object} env { ARXR, ASSETS }
 * @param {{waitUntil?: (p: Promise<any>) => void, fetch?: typeof fetch}} [deps]
 */
export async function handleLibrary(request, env, deps = {}) {
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    const waitUntil = deps.waitUntil ?? (() => {});
    try {
        const method = request.method;
        if (method === 'OPTIONS')
            return new Response(null, { status: 204 });
        if (method !== 'GET' && method !== 'HEAD')
            throw new HttpError(405, 'Метод не поддерживается.', { Allow: 'GET, HEAD' });
        const head = method === 'HEAD';
        const path = libraryPath(new URL(request.url).pathname);

        if (path === 'manifest.json') {
            const res = await env.ASSETS.fetch(new Request(new URL(MANIFEST_PATH, request.url)));
            const headers = new Headers(res.headers);
            headers.set('Content-Type', 'application/json; charset=utf-8');
            headers.set('Cache-Control', res.ok ? MANIFEST_CACHE_CONTROL : 'no-store');
            return new Response(head ? null : res.body, { status: res.status, headers });
        }

        const key = keys.library(path);
        const stored = env.ARXR ? await (head ? env.ARXR.head(key) : env.ARXR.get(key)) : null;
        if (stored) {
            const headers = new Headers({
                'Content-Type': contentTypeFor(path, stored.httpMetadata?.contentType),
                'Cache-Control': CACHE_CONTROL,
                'X-ArXR-Source': 'r2'
            });
            if (Number.isFinite(stored.size))
                headers.set('Content-Length', String(stored.size));
            if (stored.httpEtag)
                headers.set('ETag', stored.httpEtag);
            return new Response(head ? null : stored.body, { status: 200, headers });
        }

        const upstream = await fetchImpl(originUrl(path), { method: head ? 'HEAD' : 'GET' });
        if (!upstream.ok) {
            await upstream.body?.cancel().catch(() => {});
            return new Response(null, { status: upstream.status, headers: { 'Cache-Control': 'no-store', 'X-ArXR-Source': 'origin' } });
        }
        const contentType = contentTypeFor(path, upstream.headers.get('Content-Type') ?? undefined);
        const headers = new Headers({ 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL, 'X-ArXR-Source': 'origin' });
        const lengthHeader = upstream.headers.get('Content-Length');
        const length = lengthHeader === null ? NaN : Number(lengthHeader);
        if (Number.isFinite(length))
            headers.set('Content-Length', String(length));

        if (head || !upstream.body)
            return new Response(null, { status: 200, headers });

        const canStore = env.ARXR && upstream.status === 200 && !(Number.isFinite(length) && length > MAX_WRITE_THROUGH_BYTES);
        if (!canStore)
            return new Response(upstream.body, { status: upstream.status, headers });

        const [toClient, toStore] = upstream.body.tee();
        waitUntil(writeThrough(env.ARXR, key, toStore, length, contentType)
            .catch(err => console.error('ar-xr library write-through failed', key, err)));
        return new Response(toClient, { status: 200, headers });
    }
    catch (err) {
        if (err instanceof HttpError)
            return problem(err.status, err.title, err.headers);
        console.error('ar-xr library error', err);
        return problem(502, 'Библиотека моделей недоступна.');
    }
}
