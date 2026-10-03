import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleLibrary, ORIGIN } from '../../functions/ar-xr/_lib/library.js';
import { onRequest } from '../../functions/ar-xr/library/[[path]].js';
import { MANIFEST, makeEnv } from './mocks.mjs';

const BASE = 'https://artuplabs.com/ar-xr/library/';

let env;
let pending;
let fetchCalls;
let realFetch;

function lib(path, method = 'GET') {
    return handleLibrary(new Request(BASE + path, { method }), env, { waitUntil: p => pending.push(p) });
}

beforeEach(() => {
    env = makeEnv();
    pending = [];
    fetchCalls = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        fetchCalls.push({ url: String(url), method: init.method ?? 'GET' });
        if (String(url).endsWith('/missing/web.glb'))
            return new Response('nope', { status: 404 });
        const body = new Uint8Array([1, 2, 3, 4, 5]);
        return new Response(init.method === 'HEAD' ? null : body, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5' }
        });
    };
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('library proxy', () => {
    test('manifest.json comes from ASSETS', async () => {
        const res = await lib('manifest.json');
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), MANIFEST);
        assert.deepEqual(env.ASSETS.calls, ['/ar-xr/data/manifest.json']);
        assert.match(res.headers.get('Content-Type'), /application\/json/);
        assert.equal(fetchCalls.length, 0);
    });

    test('app-manifest.json comes from ASSETS /ar-xr/data/app-manifest.json', async () => {
        const app = { version: 1, collections: {}, models: [{ id: 'polyhaven:x', path: 'living/x', name: 'X', license: 'CC0-1.0' }] };
        env.ASSETS.files.set('/ar-xr/data/app-manifest.json', app);
        await env.ARXR.put('library/app-manifest.json', new Uint8Array([1]));
        const res = await lib('app-manifest.json');
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), app);
        assert.deepEqual(env.ASSETS.calls, ['/ar-xr/data/app-manifest.json']);
        assert.match(res.headers.get('Content-Type'), /application\/json/);
        assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
        assert.equal(fetchCalls.length, 0);
    });

    test('app-manifest.json missing in ASSETS → its status, no-store, no origin fetch', async () => {
        const res = await lib('app-manifest.json');
        assert.equal(res.status, 404);
        assert.equal(res.headers.get('Cache-Control'), 'no-store');
        assert.equal(fetchCalls.length, 0);
    });

    test('R2 hit is served without origin fetch', async () => {
        await env.ARXR.put('library/living/sofa-a/web.glb', new Uint8Array([9, 9, 9]));
        const res = await lib('living/sofa-a/web.glb');
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('Content-Type'), 'model/gltf-binary');
        assert.equal(res.headers.get('Cache-Control'), 'public, max-age=86400');
        assert.equal(res.headers.get('Content-Length'), '3');
        assert.equal(res.headers.get('X-ArXR-Source'), 'r2');
        assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [9, 9, 9]);
        assert.equal(fetchCalls.length, 0);
    });

    test('miss → origin fetch → write-through via waitUntil', async () => {
        const res = await lib('living/sofa-a/model.usdz');
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('Content-Type'), 'model/vnd.usdz+zip');
        assert.equal(res.headers.get('X-ArXR-Source'), 'origin');
        assert.deepEqual(fetchCalls, [{ url: ORIGIN + 'living/sofa-a/model.usdz', method: 'GET' }]);
        assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3, 4, 5]);
        assert.equal(pending.length, 1);
        await Promise.all(pending);
        const stored = await env.ARXR.get('library/living/sofa-a/model.usdz');
        assert.ok(stored);
        assert.deepEqual([...new Uint8Array(await stored.arrayBuffer())], [1, 2, 3, 4, 5]);
        assert.equal(stored.httpMetadata.contentType, 'model/vnd.usdz+zip');

        const second = await lib('living/sofa-a/model.usdz');
        assert.equal(second.headers.get('X-ArXR-Source'), 'r2');
        assert.equal(fetchCalls.length, 1);
    });

    test('origin non-2xx passes status, no write', async () => {
        const res = await lib('missing/web.glb');
        assert.equal(res.status, 404);
        assert.equal(pending.length, 0);
        assert.equal(env.ARXR.keysWithPrefix('library/').length, 0);
    });

    test('content types by extension', async () => {
        const png = await lib('a/preview.png');
        assert.equal(png.headers.get('Content-Type'), 'image/png');
        const json = await lib('a/meta.json');
        assert.equal(json.headers.get('Content-Type'), 'application/json');
        await Promise.all(pending);
    });

    test('path traversal → 400', async () => {
        for (const p of ['..%2Fsecret', 'a/%2E%2E%2Fb', 'a/..%2F..%2Fb', 'a//b', 'a%5Cb']) {
            const res = await lib(p);
            assert.equal(res.status, 400, p);
            assert.equal((await res.json()).status, 400);
        }
        assert.equal(fetchCalls.length, 0);
    });

    test('HEAD: R2 hit and origin miss without body or write', async () => {
        await env.ARXR.put('library/x/web.glb', new Uint8Array([1, 2]));
        const hit = await lib('x/web.glb', 'HEAD');
        assert.equal(hit.status, 200);
        assert.equal(hit.headers.get('Content-Length'), '2');
        assert.equal(hit.body, null);

        const miss = await lib('y/web.glb', 'HEAD');
        assert.equal(miss.status, 200);
        assert.equal(miss.headers.get('Content-Length'), '5');
        assert.deepEqual(fetchCalls, [{ url: ORIGIN + 'y/web.glb', method: 'HEAD' }]);
        assert.equal(pending.length, 0);

        const manifest = await lib('manifest.json', 'HEAD');
        assert.equal(manifest.status, 200);
        assert.equal(manifest.body, null);
    });

    test('other methods → 405', async () => {
        const res = await lib('x/web.glb', 'POST');
        assert.equal(res.status, 405);
        assert.equal(res.headers.get('Allow'), 'GET, HEAD');
    });

    test('Pages entry point wires waitUntil', async () => {
        const waits = [];
        const res = await onRequest({
            request: new Request(BASE + 'z/web.glb'),
            env,
            waitUntil: p => waits.push(p)
        });
        await res.arrayBuffer();
        assert.equal(waits.length, 1);
        await Promise.all(waits);
        assert.ok(await env.ARXR.head('library/z/web.glb'));
    });
});
