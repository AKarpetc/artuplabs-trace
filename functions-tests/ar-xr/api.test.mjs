import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleApi } from '../../functions/ar-xr/_lib/router.js';
import { resetCatalogCache } from '../../functions/ar-xr/_lib/catalog.js';
import { onRequest } from '../../functions/ar-xr/api/[[path]].js';
import { makeClock, makeEnv } from './mocks.mjs';

const ORIGIN = 'https://artuplabs.com';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function client(env, clock) {
    return async function call(method, path, { body, headers = {}, rawBody } = {}) {
        const init = { method, headers: { ...headers } };
        if (rawBody !== undefined) {
            init.body = rawBody;
        }
        else if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await handleApi(new Request(`${ORIGIN}/ar-xr/api${path}`, init), env, { now: clock.now });
        clock.advance(1000);
        const text = await res.text();
        let data = null;
        if (text)
            data = JSON.parse(text);
        return { status: res.status, data, headers: res.headers };
    };
}

let env;
let clock;
let call;

beforeEach(() => {
    resetCatalogCache();
    env = makeEnv();
    clock = makeClock();
    call = client(env, clock);
});

async function newProject() {
    const r = await call('POST', '/projects', { body: {} });
    assert.equal(r.status, 201);
    return r.data;
}

const tok = t => ({ 'X-Device-Token': t });

describe('device projects and rooms', () => {
    test('create project → room → layout → public read', async () => {
        const p = await newProject();
        assert.match(p.projectId, /^[0-9a-f-]{36}$/);
        assert.equal(p.id, p.projectId);
        assert.equal(p.name, null);
        assert.equal(typeof p.deviceToken, 'string');

        const stored = env.ARXR.readJson(`projects/${p.projectId}.json`);
        assert.notEqual(stored.tokenHash, p.deviceToken, 'token stored hashed');
        assert.equal(stored.tokenHash.length, 64);

        const got = await call('GET', `/projects/${p.projectId}`);
        assert.equal(got.status, 200);
        assert.equal(got.data.projectId, p.projectId);
        assert.equal(got.data.deviceToken, undefined);

        const noTok = await call('POST', `/projects/${p.projectId}/rooms`, { body: { name: 'X' } });
        assert.equal(noTok.status, 403);

        const room = await call('POST', `/projects/${p.projectId}/rooms`, { body: { name: 'Кухня' }, headers: tok(p.deviceToken) });
        assert.equal(room.status, 201);
        assert.equal(room.data.name, 'Кухня');
        assert.equal(room.data.itemCount, 0);
        assert.equal(room.data.quote, null);
        const roomId = room.data.roomId;

        const layout = { models: [
            { modelId: 'living/sofa-a', matrix: IDENTITY },
            { modelId: 'living/chair-b', matrix: IDENTITY },
            { modelId: 'living/chair-b', matrix: IDENTITY },
            { modelId: 'unknown/thing', matrix: IDENTITY }
        ] };
        const wrong = await call('PUT', `/projects/${p.projectId}/rooms/${roomId}/layout`, { body: layout, headers: tok('nope-nope') });
        assert.equal(wrong.status, 403);
        assert.deepEqual(wrong.data, { title: wrong.data.title, status: 403 });

        const saved = await call('PUT', `/projects/${p.projectId}/rooms/${roomId}/layout`, { body: layout, headers: tok(p.deviceToken) });
        assert.equal(saved.status, 200);
        assert.equal(saved.data.itemCount, 4);
        assert.equal(saved.data.quote.totals.USD, 498.99);
        assert.deepEqual(saved.data.quote.missing, ['unknown/thing']);
        assert.equal(saved.data.models, undefined, 'Room does not leak layout');

        const pub = await call('GET', `/public/projects/${p.projectId}/rooms/${roomId}/layout`);
        assert.equal(pub.status, 200);
        assert.equal(pub.data.roomId, roomId);
        assert.equal(pub.data.models.length, 4);
        assert.deepEqual(pub.data.models[0], { modelId: 'living/sofa-a', matrix: IDENTITY });

        const pubRoom = await call('GET', `/public/projects/${p.projectId}/rooms/${roomId}`);
        assert.equal(pubRoom.data.itemCount, 4);
        assert.equal(pubRoom.data.quote.totals.USD, 498.99);

        const models = await call('GET', `/public/projects/${p.projectId}/models`);
        assert.deepEqual(models.data, []);
    });

    test('list sorted by updatedAt desc, rename, delete', async () => {
        const p = await newProject();
        const h = tok(p.deviceToken);
        const r1 = (await call('POST', `/projects/${p.projectId}/rooms`, { body: { name: null }, headers: h })).data;
        const r2 = (await call('POST', `/projects/${p.projectId}/rooms`, { body: {}, headers: h })).data;
        assert.equal(r1.name, 'Комната 1');
        assert.equal(r2.name, 'Комната 2');

        let list = await call('GET', `/projects/${p.projectId}/rooms`);
        assert.deepEqual(list.data.map(r => r.roomId), [r2.roomId, r1.roomId]);

        const renamed = await call('PUT', `/projects/${p.projectId}/rooms/${r1.roomId}`, { body: { name: '  Зал  ' }, headers: h });
        assert.equal(renamed.status, 200);
        assert.equal(renamed.data.name, 'Зал');
        list = await call('GET', `/projects/${p.projectId}/rooms`);
        assert.deepEqual(list.data.map(r => r.roomId), [r1.roomId, r2.roomId]);

        assert.equal((await call('PUT', `/projects/${p.projectId}/rooms/${r1.roomId}`, { body: { name: '' }, headers: h })).status, 400);
        assert.equal((await call('PUT', `/projects/${p.projectId}/rooms/${r1.roomId}`, { body: { name: 'x'.repeat(81) }, headers: h })).status, 400);
        assert.equal((await call('DELETE', `/projects/${p.projectId}/rooms/${r1.roomId}`)).status, 403);
        assert.equal((await call('DELETE', `/projects/${p.projectId}/rooms/${r1.roomId}`, { headers: h })).status, 204);
        assert.equal((await call('GET', `/projects/${p.projectId}/rooms/${r1.roomId}`)).status, 404);
        assert.equal((await call('DELETE', `/projects/${p.projectId}/rooms/${r1.roomId}`, { headers: h })).status, 404);
    });

    test('404 / 405 / 400 / 413 / OPTIONS', async () => {
        const missing = crypto.randomUUID();
        assert.equal((await call('GET', `/projects/${missing}`)).status, 404);
        assert.equal((await call('GET', `/projects/not-a-uuid`)).status, 404);
        assert.equal((await call('GET', `/projects/${missing}/rooms`)).status, 404);
        assert.equal((await call('GET', `/public/projects/${missing}/rooms/${missing}/layout`)).status, 404);
        assert.equal((await call('GET', '/nope')).status, 404);

        const r405 = await call('DELETE', '/projects');
        assert.equal(r405.status, 405);
        assert.equal(r405.headers.get('Allow'), 'POST');
        assert.equal(r405.data.status, 405);

        const p = await newProject();
        const h = tok(p.deviceToken);
        const room = (await call('POST', `/projects/${p.projectId}/rooms`, { body: {}, headers: h })).data;
        const lp = `/projects/${p.projectId}/rooms/${room.roomId}/layout`;
        assert.equal((await call('PUT', lp, { body: { models: [{ modelId: 'a', matrix: [1, 2, 3] }] }, headers: h })).status, 400);
        assert.equal((await call('PUT', lp, { body: { models: [{ modelId: 'a', matrix: [...IDENTITY.slice(0, 15), null] }] }, headers: h })).status, 400);
        assert.equal((await call('PUT', lp, { body: { models: [{ matrix: IDENTITY }] }, headers: h })).status, 400);
        assert.equal((await call('PUT', lp, { body: { models: 'x' }, headers: h })).status, 400);
        const tooMany = Array.from({ length: 201 }, () => ({ modelId: 'a', matrix: IDENTITY }));
        assert.equal((await call('PUT', lp, { body: { models: tooMany }, headers: h })).status, 400);
        const bad = await call('PUT', lp, { rawBody: '{oops', headers: { ...h, 'Content-Type': 'application/json' } });
        assert.equal(bad.status, 400);
        assert.equal(typeof bad.data.title, 'string');
        const big = await call('PUT', lp, { rawBody: JSON.stringify({ models: [], pad: 'x'.repeat(300 * 1024) }), headers: { ...h, 'Content-Type': 'application/json' } });
        assert.equal(big.status, 413);
        assert.equal((await call('POST', '/quote', { rawBody: 'items=1', headers: { 'Content-Type': 'text/plain' } })).status, 415);

        assert.equal((await call('OPTIONS', '/projects')).status, 204);
    });

    test('room limit 200 → 409', async () => {
        const p = await newProject();
        for (let i = 0; i < 200; i++)
            await env.ARXR.put(`rooms/${p.projectId}/${crypto.randomUUID()}.json`, JSON.stringify({ roomId: 'x', updatedAt: '' }));
        const r = await call('POST', `/projects/${p.projectId}/rooms`, { body: {}, headers: tok(p.deviceToken) });
        assert.equal(r.status, 409);
    });

    test('Pages entry point delegates to router', async () => {
        const res = await onRequest({ request: new Request(`${ORIGIN}/ar-xr/api/projects`, { method: 'POST' }), env, waitUntil() {} });
        assert.equal(res.status, 201);
        assert.match(res.headers.get('Content-Type'), /application\/json/);
    });
});

describe('quote', () => {
    test('totals in 3 currencies with override and missing', async () => {
        await env.ARXR.put('settings/models.json', JSON.stringify({
            updatedAt: 'x', models: { 'living/chair-b': { priceUsd: 10, name: 'Стул' } }
        }));
        const r = await call('POST', '/quote', { body: { items: [
            { modelId: 'living/sofa-a', qty: 2 },
            { modelId: 'living/chair-b', qty: 3 },
            { modelId: 'living/sofa-a' },
            { modelId: 'nope/x' }
        ] } });
        assert.equal(r.status, 200);
        const q = r.data;
        assert.equal(q.currency, 'USD');
        assert.deepEqual(q.lines, [
            { modelId: 'living/sofa-a', name: 'Sofa A', qty: 3, unitUsd: 399.99, totalUsd: 1199.97 },
            { modelId: 'living/chair-b', name: 'Стул', qty: 3, unitUsd: 10, totalUsd: 30 }
        ]);
        assert.deepEqual(q.missing, ['nope/x']);
        assert.equal(q.totals.USD, 1229.97);
        assert.equal(q.totals.KZT, Math.round(1229.97 * 444.08));
        assert.equal(q.totals.RUB, Math.round(1229.97 * 83.5));
        assert.deepEqual(q.rates, { date: '2026-10-03', source: 'open.er-api.com', KZT: 444.08, RUB: 83.5 });
        assert.equal(q.computedAt, new Date(clock.t - 1000).toISOString());
    });

    test('models form, validation, asset caching', async () => {
        const r = await call('POST', '/quote', { body: { models: [{ modelId: 'kitchen/table-c' }, { modelId: 'kitchen/table-c' }] } });
        assert.equal(r.data.lines[0].qty, 2);
        assert.equal(r.data.totals.USD, 240);
        await call('POST', '/quote', { body: { models: [{ modelId: 'kitchen/table-c' }] } });
        assert.equal(env.ASSETS.calls.filter(p => p.endsWith('prices.json')).length, 1, 'prices cached per isolate');
        clock.advance(6 * 60 * 1000);
        await call('POST', '/quote', { body: { models: [{ modelId: 'kitchen/table-c' }] } });
        assert.equal(env.ASSETS.calls.filter(p => p.endsWith('prices.json')).length, 2, 'cache expires after 5 min');

        assert.equal((await call('POST', '/quote', { body: {} })).status, 400);
        assert.equal((await call('POST', '/quote', { body: { items: [{ modelId: 'a', qty: 0 }] } })).status, 400);
        assert.equal((await call('POST', '/quote', { body: { items: [{ modelId: 'a', qty: 1.5 }] } })).status, 400);
        assert.equal((await call('GET', '/quote')).status, 405);
    });

    test('prices unavailable → 503', async () => {
        env.ASSETS.files.delete('/ar-xr/data/prices.json');
        const r = await call('POST', '/quote', { body: { models: [{ modelId: 'a' }] } });
        assert.equal(r.status, 503);
    });
});

describe('accounts', () => {
    test('register adopts device project; me; logout', async () => {
        const p = await newProject();
        const reg = await call('POST', '/auth/register', { body: {
            email: '  User@Example.COM ', password: 'secret123', device: { projectId: p.projectId, deviceToken: p.deviceToken }
        } });
        assert.equal(reg.status, 201);
        assert.equal(reg.data.email, 'user@example.com');
        assert.deepEqual(reg.data.project, { projectId: p.projectId, deviceToken: p.deviceToken });
        assert.ok(reg.data.token.length >= 40);

        const userKeys = env.ARXR.keysWithPrefix('users/');
        assert.equal(userKeys.length, 1);
        const user = env.ARXR.readJson(userKeys[0]);
        assert.equal(user.password.iterations, 100000);
        assert.equal(user.password.salt.length, 32);
        assert.ok(!JSON.stringify(user).includes('secret123'));
        assert.equal(env.ARXR.readJson(`projects/${p.projectId}.json`).ownerEmailHash, user.emailHash);
        assert.equal(env.ARXR.keysWithPrefix('sessions/')[0].includes(reg.data.token), false, 'session key is hashed');

        const auth = { Authorization: `Bearer ${reg.data.token}` };
        const me = await call('GET', '/auth/me', { headers: auth });
        assert.equal(me.status, 200);
        assert.deepEqual(me.data, { email: 'user@example.com', project: { projectId: p.projectId, deviceToken: p.deviceToken } });

        assert.equal((await call('GET', '/auth/me')).status, 401);
        assert.equal((await call('POST', '/auth/logout', { headers: auth })).status, 204);
        assert.equal((await call('GET', '/auth/me', { headers: auth })).status, 401);

        const dup = await call('POST', '/auth/register', { body: { email: 'user@example.com', password: 'another123' } });
        assert.equal(dup.status, 409);
    });

    test('register with foreign-owned or invalid device creates new project', async () => {
        const p = await newProject();
        const a = await call('POST', '/auth/register', { body: { email: 'a@ex.com', password: 'password1', device: { projectId: p.projectId, deviceToken: p.deviceToken } } });
        const b = await call('POST', '/auth/register', { body: { email: 'b@ex.com', password: 'password1', device: { projectId: p.projectId, deviceToken: p.deviceToken } } });
        assert.equal(a.data.project.projectId, p.projectId);
        assert.notEqual(b.data.project.projectId, p.projectId);
        const c = await call('POST', '/auth/register', { body: { email: 'c@ex.com', password: 'password1', device: { projectId: p.projectId, deviceToken: 'wrong-token' } } });
        assert.notEqual(c.data.project.projectId, p.projectId);
        const project = env.ARXR.readJson(`projects/${c.data.project.projectId}.json`);
        assert.ok(project.ownerEmailHash);

        assert.equal((await call('POST', '/auth/register', { body: { email: 'bad', password: 'password1' } })).status, 400);
        assert.equal((await call('POST', '/auth/register', { body: { email: 'd@ex.com', password: 'short' } })).status, 400);
        assert.equal((await call('POST', '/auth/register', { body: { email: 'd@ex.com', password: 'password1', device: 'x' } })).status, 400);
    });

    test('session expires after 30 days', async () => {
        const reg = await call('POST', '/auth/register', { body: { email: 'e@ex.com', password: 'password1' } });
        clock.advance(30 * 24 * 3600 * 1000 + 1);
        assert.equal((await call('GET', '/auth/me', { headers: { Authorization: `Bearer ${reg.data.token}` } })).status, 401);
    });

    test('login from second device merges rooms into account project', async () => {
        // Device A registers with its project and one room.
        const pa = await newProject();
        const roomA = (await call('POST', `/projects/${pa.projectId}/rooms`, { body: { name: 'A' }, headers: tok(pa.deviceToken) })).data;
        const reg = await call('POST', '/auth/register', { body: { email: 'm@ex.com', password: 'password1', device: { projectId: pa.projectId, deviceToken: pa.deviceToken } } });
        assert.equal(reg.data.project.projectId, pa.projectId);

        // Device B has its own project with a room + layout.
        const pb = await newProject();
        const roomB = (await call('POST', `/projects/${pb.projectId}/rooms`, { body: { name: 'B' }, headers: tok(pb.deviceToken) })).data;
        await call('PUT', `/projects/${pb.projectId}/rooms/${roomB.roomId}/layout`, {
            body: { models: [{ modelId: 'living/sofa-a', matrix: IDENTITY }] }, headers: tok(pb.deviceToken)
        });

        const login = await call('POST', '/auth/login', { body: { email: 'M@ex.com', password: 'password1', device: { projectId: pb.projectId, deviceToken: pb.deviceToken } } });
        assert.equal(login.status, 200);
        assert.deepEqual(login.data.project, { projectId: pa.projectId, deviceToken: pa.deviceToken });
        assert.equal(login.data.mergedRooms, 1);

        const rooms = (await call('GET', `/projects/${pa.projectId}/rooms`)).data;
        assert.deepEqual(rooms.map(r => r.name).sort(), ['A', 'B']);
        assert.ok(rooms.some(r => r.roomId === roomA.roomId));
        const merged = await call('GET', `/public/projects/${pa.projectId}/rooms/${roomB.roomId}/layout`);
        assert.equal(merged.data.models.length, 1);
        const mergedRoom = rooms.find(r => r.roomId === roomB.roomId);
        assert.equal(mergedRoom.quote.totals.USD, 399.99);

        // Repeat login does not duplicate.
        const again = await call('POST', '/auth/login', { body: { email: 'm@ex.com', password: 'password1', device: { projectId: pb.projectId, deviceToken: pb.deviceToken } } });
        assert.equal(again.data.mergedRooms, 0);
        assert.equal((await call('GET', `/projects/${pa.projectId}/rooms`)).data.length, 2);

        // The returned token writes into the account project.
        const write = await call('POST', `/projects/${pa.projectId}/rooms`, { body: { name: 'C' }, headers: tok(login.data.project.deviceToken) });
        assert.equal(write.status, 201);
    });

    test('throttle: 10 failures in 15 min → 429, then window expires', async () => {
        await call('POST', '/auth/register', { body: { email: 't@ex.com', password: 'password1' } });
        for (let i = 0; i < 10; i++) {
            const r = await call('POST', '/auth/login', { body: { email: 't@ex.com', password: 'wrongpass' } });
            assert.equal(r.status, 401);
        }
        const blocked = await call('POST', '/auth/login', { body: { email: 't@ex.com', password: 'password1' } });
        assert.equal(blocked.status, 429);
        assert.equal(blocked.data.status, 429);
        clock.advance(15 * 60 * 1000);
        const ok = await call('POST', '/auth/login', { body: { email: 't@ex.com', password: 'password1' } });
        assert.equal(ok.status, 200);
        const unknown = await call('POST', '/auth/login', { body: { email: 'nobody@ex.com', password: 'password1' } });
        assert.equal(unknown.status, 401);
    });
});

describe('model settings and admin', () => {
    const admin = { 'X-Admin-Token': 'adm-secret' };

    test('PUT requires admin, null removes field, GET reflects, DELETE resets', async () => {
        env.ARXR_ADMIN_TOKEN = 'adm-secret';
        const empty = await call('GET', '/model-settings');
        assert.equal(empty.status, 200);
        assert.deepEqual(empty.data.models, {});

        const path = '/model-settings/' + encodeURIComponent('living/sofa-a');
        assert.equal((await call('PUT', path, { body: { priceUsd: 1 } })).status, 401);
        assert.equal((await call('PUT', path, { body: { priceUsd: 1 }, headers: { 'X-Admin-Token': 'adm-secreT' } })).status, 401);

        const put = await call('PUT', path, { body: { name: 'Диван', priceUsd: 250, hidden: true, xrScale: 1.2 }, headers: admin });
        assert.equal(put.status, 200);
        assert.deepEqual(put.data, { name: 'Диван', priceUsd: 250, hidden: true, xrScale: 1.2 });

        const put2 = await call('PUT', path, { body: { hidden: null, name: null }, headers: admin });
        assert.deepEqual(put2.data, { priceUsd: 250, xrScale: 1.2 });

        // Unencoded multi-segment path works too.
        await call('PUT', '/model-settings/kitchen/table-c', { body: { priceUsd: 99 }, headers: admin });

        const got = await call('GET', '/model-settings');
        assert.deepEqual(got.data.models, { 'living/sofa-a': { priceUsd: 250, xrScale: 1.2 }, 'kitchen/table-c': { priceUsd: 99 } });
        assert.ok(got.data.updatedAt);

        const q = await call('POST', '/quote', { body: { models: [{ modelId: 'living/sofa-a' }] } });
        assert.equal(q.data.lines[0].unitUsd, 250);

        assert.equal((await call('PUT', path, { body: { priceUsd: -1 }, headers: admin })).status, 400);
        assert.equal((await call('PUT', path, { body: { xrScale: 0 }, headers: admin })).status, 400);
        assert.equal((await call('PUT', path, { body: { hidden: 'yes' }, headers: admin })).status, 400);
        assert.equal((await call('PUT', path, { body: { color: 'red' }, headers: admin })).status, 400);
        assert.equal((await call('PUT', '/model-settings/' + encodeURIComponent('../etc'), { body: {}, headers: admin })).status, 400);

        assert.equal((await call('DELETE', path)).status, 401);
        assert.equal((await call('DELETE', path, { headers: admin })).status, 204);
        assert.deepEqual((await call('GET', '/model-settings')).data.models, { 'kitchen/table-c': { priceUsd: 99 } });

        // Clearing every field drops the entry.
        await call('PUT', '/model-settings/kitchen/table-c', { body: { priceUsd: null }, headers: admin });
        assert.deepEqual((await call('GET', '/model-settings')).data.models, {});
    });

    test('admin check 401 / 204 / 503', async () => {
        assert.equal((await call('GET', '/admin/check', { headers: admin })).status, 503);
        assert.equal((await call('PUT', '/model-settings/a', { body: {}, headers: admin })).status, 503);
        env.ARXR_ADMIN_TOKEN = 'adm-secret';
        assert.equal((await call('GET', '/admin/check')).status, 401);
        assert.equal((await call('GET', '/admin/check', { headers: { 'X-Admin-Token': 'x' } })).status, 401);
        assert.equal((await call('GET', '/admin/check', { headers: admin })).status, 204);
        assert.equal((await call('POST', '/admin/check', { headers: admin })).status, 405);
    });
});
