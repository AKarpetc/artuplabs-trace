// Передача входа с компьютера на телефон по QR: одноразовый код на 5 минут.
// Код аккаунта даёт телефону новую сессию; код устройства — тот же проект устройства.

import { randomToken, sha256Hex } from './crypto.js';
import { HttpError } from './http.js';
import { getJson, keys, putJson } from './store.js';
import { createSession, ensureAccountProject, requireUser, validDevice } from './auth.js';

export const HANDOFF_TTL_MS = 5 * 60 * 1000;
export const HANDOFF_MAX_ACTIVE = 10;
export const REDEEM_WINDOW_MS = 15 * 60 * 1000;
export const REDEEM_MAX_FAILURES = 20;

const CODE_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Индекс активных кодов владельца (`a-<emailHash>` или `p-<projectId>`): по нему
 * считается лимит, просроченные коды удаляются при создании нового.
 */
async function reserveSlot(env, owner, codeHash, exp, now) {
    const indexKey = keys.handoffIndex(owner);
    const index = await getJson(env.ARXR, indexKey);
    const codes = Array.isArray(index?.codes) ? index.codes : [];
    const active = [];
    for (const c of codes) {
        if (c && c.exp > now)
            active.push(c);
        else if (c?.hash)
            await env.ARXR.delete(keys.handoff(c.hash));
    }
    if (active.length >= HANDOFF_MAX_ACTIVE)
        throw new HttpError(429, 'Слишком много активных кодов. Подождите 5 минут.', { 'Retry-After': '300' });
    active.push({ hash: codeHash, exp });
    await putJson(env.ARXR, indexKey, { codes: active });
}

async function releaseSlot(env, owner, codeHash) {
    const indexKey = keys.handoffIndex(owner);
    const index = await getJson(env.ARXR, indexKey);
    if (!Array.isArray(index?.codes))
        return;
    await putJson(env.ARXR, indexKey, { codes: index.codes.filter(c => c?.hash !== codeHash) });
}

/** POST /auth/handoff: Bearer-сессия (аккаунт) или `{device}` в теле. */
export async function createHandoff(env, request, body, now) {
    let record;
    let owner;
    if (request.headers.has('Authorization')) {
        const { user } = await requireUser(env, request, now);
        await ensureAccountProject(env, user, now);
        record = { kind: 'account', emailHash: user.emailHash, projectId: user.projectId };
        owner = `a-${user.emailHash}`;
    }
    else if (body.device !== undefined && body.device !== null) {
        const d = body.device;
        if (!d || typeof d !== 'object' || typeof d.projectId !== 'string' || typeof d.deviceToken !== 'string')
            throw new HttpError(400, 'device — { projectId, deviceToken }.');
        const project = await validDevice(env, d);
        if (!project)
            throw new HttpError(403, 'Нет права на проект.');
        record = { kind: 'device', projectId: project.projectId, deviceToken: d.deviceToken };
        owner = `p-${project.projectId}`;
    }
    else {
        throw new HttpError(401, 'Нужен вход или проект устройства.');
    }

    const code = randomToken(16);
    const codeHash = await sha256Hex(code);
    const exp = now + HANDOFF_TTL_MS;
    await reserveSlot(env, owner, codeHash, exp, now);
    await putJson(env.ARXR, keys.handoff(codeHash), { ...record, owner, exp });
    return { code, expiresAt: new Date(exp).toISOString() };
}

async function ipKey(request) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    return keys.ipThrottle(await sha256Hex(ip));
}

async function recordFailure(env, key, failures, now) {
    failures.push(now);
    await putJson(env.ARXR, key, { failures });
}

/** POST /auth/handoff/redeem: одноразово; код удаляется до ответа. */
export async function redeemHandoff(env, request, body, now) {
    if (typeof body.code !== 'string')
        throw new HttpError(400, 'Нужен code.');

    const throttleKey = await ipKey(request);
    const doc = await getJson(env.ARXR, throttleKey);
    const failures = (Array.isArray(doc?.failures) ? doc.failures : [])
        .filter(t => Number.isFinite(t) && now - t < REDEEM_WINDOW_MS);
    if (failures.length >= REDEEM_MAX_FAILURES)
        throw new HttpError(429, 'Слишком много попыток. Попробуйте через 15 минут.', { 'Retry-After': '900' });

    const gone = async () => {
        await recordFailure(env, throttleKey, failures, now);
        return new HttpError(410, 'Код недействителен или истёк. Покажите новый QR-код.');
    };

    if (!CODE_RE.test(body.code))
        throw await gone();
    const codeHash = await sha256Hex(body.code);
    const key = keys.handoff(codeHash);
    const record = await getJson(env.ARXR, key);
    if (!record)
        throw await gone();
    if (!(record.exp > now)) {
        await env.ARXR.delete(key).catch(() => {});
        throw await gone();
    }

    try {
        await env.ARXR.delete(key);
    }
    catch {
        throw new HttpError(500, 'Не удалось погасить код.');
    }
    if (record.owner)
        await releaseSlot(env, record.owner, codeHash).catch(() => {});

    if (record.kind === 'device') {
        if (!(await validDevice(env, { projectId: record.projectId, deviceToken: record.deviceToken })))
            throw new HttpError(410, 'Проект больше недоступен.');
        return { project: { projectId: record.projectId, deviceToken: record.deviceToken } };
    }

    const user = await getJson(env.ARXR, keys.user(record.emailHash));
    if (!user)
        throw new HttpError(410, 'Аккаунт больше недоступен.');
    await ensureAccountProject(env, user, now);
    const token = await createSession(env, user.emailHash, now);
    return { token, email: user.email, project: { projectId: user.projectId, deviceToken: user.deviceToken } };
}
