import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleApi } from '../../functions/ar-xr/_lib/router.js';
import { resetCatalogCache } from '../../functions/ar-xr/_lib/catalog.js';
import { makeClock, makeEnv } from './mocks.mjs';

let env;
let clock;

async function call(method, path, { body, headers = {} } = {}) {
    const init = { method, headers: { 'CF-Connecting-IP': '203.0.113.7', ...headers } };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const res = await handleApi(new Request(`https://artuplabs.com/ar-xr/api${path}`, init), env, { now: clock.now });
    clock.advance(1000);
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
}

beforeEach(() => {
    resetCatalogCache();
    env = makeEnv();
    clock = makeClock();
});

async function account(email = 'h@ex.com') {
    const r = await call('POST', '/auth/register', { body: { email, password: 'password1' } });
    assert.equal(r.status, 201);
    return r.data;
}

async function device() {
    const r = await call('POST', '/projects', { body: {} });
    return r.data;
}

describe('QR handoff', () => {
    test('account handoff → redeem gives a working session', async () => {
        const acc = await account();
        const h = await call('POST', '/auth/handoff', { headers: { Authorization: `Bearer ${acc.token}` } });
        assert.equal(h.status, 201);
        assert.match(h.data.code, /^[A-Za-z0-9_-]{22}$/);
        assert.equal(Date.parse(h.data.expiresAt) - (clock.t - 1000), 5 * 60 * 1000);
        assert.equal(env.ARXR.keysWithPrefix('handoff/').length, 1);
        assert.ok(!env.ARXR.keysWithPrefix('handoff/')[0].includes(h.data.code), 'code stored hashed');

        const r = await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } });
        assert.equal(r.status, 200);
        assert.equal(r.data.email, 'h@ex.com');
        assert.deepEqual(r.data.project, acc.project);
        assert.notEqual(r.data.token, acc.token);

        const me = await call('GET', '/auth/me', { headers: { Authorization: `Bearer ${r.data.token}` } });
        assert.equal(me.status, 200);
        assert.equal(me.data.email, 'h@ex.com');

        const again = await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } });
        assert.equal(again.status, 410);
        assert.equal(typeof again.data.title, 'string');
        assert.equal(env.ARXR.keysWithPrefix('handoff/').length, 0);
    });

    test('device handoff returns the same device project', async () => {
        const d = await device();
        const h = await call('POST', '/auth/handoff', { body: { device: { projectId: d.projectId, deviceToken: d.deviceToken } } });
        assert.equal(h.status, 201);
        const r = await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.data, { project: { projectId: d.projectId, deviceToken: d.deviceToken } });
        assert.equal((await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } })).status, 410);
    });

    test('expired code → 410', async () => {
        const d = await device();
        const h = await call('POST', '/auth/handoff', { body: { device: { projectId: d.projectId, deviceToken: d.deviceToken } } });
        clock.advance(5 * 60 * 1000);
        assert.equal((await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } })).status, 410);
    });

    test('auth errors: bad device token 403, no auth 401, bad session 401, bad body 400', async () => {
        const d = await device();
        assert.equal((await call('POST', '/auth/handoff', { body: { device: { projectId: d.projectId, deviceToken: 'wrong' } } })).status, 403);
        assert.equal((await call('POST', '/auth/handoff', { body: { device: { projectId: crypto.randomUUID(), deviceToken: d.deviceToken } } })).status, 403);
        assert.equal((await call('POST', '/auth/handoff', { body: {} })).status, 401);
        assert.equal((await call('POST', '/auth/handoff', { headers: { Authorization: 'Bearer ' + 'x'.repeat(43) } })).status, 401);
        assert.equal((await call('POST', '/auth/handoff', { body: { device: 'x' } })).status, 400);
        assert.equal((await call('POST', '/auth/handoff/redeem', { body: {} })).status, 400);
        assert.equal((await call('GET', '/auth/handoff')).status, 405);
    });

    test('at most 10 active codes per owner; expired ones are cleaned on create', async () => {
        const d = await device();
        const body = { device: { projectId: d.projectId, deviceToken: d.deviceToken } };
        for (let i = 0; i < 10; i++)
            assert.equal((await call('POST', '/auth/handoff', { body })).status, 201);
        assert.equal((await call('POST', '/auth/handoff', { body })).status, 429);
        clock.advance(5 * 60 * 1000);
        assert.equal((await call('POST', '/auth/handoff', { body })).status, 201);
        assert.equal(env.ARXR.keysWithPrefix('handoff/').length, 1);
    });

    test('redeem throttle: 20 failures per IP in 15 min → 429', async () => {
        for (let i = 0; i < 20; i++)
            assert.equal((await call('POST', '/auth/handoff/redeem', { body: { code: `bad${i}` } })).status, 410);
        const d = await device();
        const h = await call('POST', '/auth/handoff', { body: { device: { projectId: d.projectId, deviceToken: d.deviceToken } } });
        assert.equal((await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } })).status, 429);
        const other = await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code }, headers: { 'CF-Connecting-IP': '198.51.100.1' } });
        assert.equal(other.status, 200, 'other IP is not throttled');
        clock.advance(15 * 60 * 1000);
        assert.equal((await call('POST', '/auth/handoff/redeem', { body: { code: 'whatever' } })).status, 410);
    });

    test('delete failure → 500 and nothing issued', async () => {
        const acc = await account();
        const h = await call('POST', '/auth/handoff', { headers: { Authorization: `Bearer ${acc.token}` } });
        const sessionsBefore = env.ARXR.keysWithPrefix('sessions/').length;
        const realDelete = env.ARXR.delete.bind(env.ARXR);
        env.ARXR.delete = async key => {
            if (String(key).startsWith('handoff/'))
                throw new Error('r2 down');
            return realDelete(key);
        };
        const r = await call('POST', '/auth/handoff/redeem', { body: { code: h.data.code } });
        assert.equal(r.status, 500);
        assert.equal(r.data.token, undefined);
        assert.equal(env.ARXR.keysWithPrefix('sessions/').length, sessionsBefore);
    });
});
