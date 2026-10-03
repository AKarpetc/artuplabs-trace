// Учётные записи (email + пароль), сессии и ограничение неудачных входов.

import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto.js';
import { HttpError } from './http.js';
import { getJson, keys, putJson } from './store.js';
import { createProject, loadProject, mergeRooms, tokenMatches } from './projects.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const THROTTLE_MAX_FAILURES = 10;

const emailHashOf = email => sha256Hex(email);

async function createSession(env, emailHash, now) {
    const token = randomToken();
    await putJson(env.ARXR, keys.session(await sha256Hex(token)), { emailHash, exp: now + SESSION_TTL_MS });
    return token;
}

/** Проверяет `device` из тела: проект существует и токен совпадает. */
async function validDevice(env, device) {
    if (!device)
        return null;
    const record = await loadProject(env, device.projectId);
    if (!record || !(await tokenMatches(record, device.deviceToken)))
        return null;
    return record;
}

/** Проект аккаунта; если он пропал из хранилища — создаётся новый и запоминается в записи пользователя. */
async function ensureAccountProject(env, user, now) {
    const record = await loadProject(env, user.projectId);
    if (record)
        return;
    const created = await createProject(env, now, user.emailHash);
    user.projectId = created.record.projectId;
    user.deviceToken = created.deviceToken;
    await putJson(env.ARXR, keys.user(user.emailHash), user);
}

function accountView(user, token, extra = {}) {
    return { token, email: user.email, project: { projectId: user.projectId, deviceToken: user.deviceToken }, ...extra };
}

export async function register(env, { email, password, device }, now) {
    const emailHash = await emailHashOf(email);
    const userKey = keys.user(emailHash);
    if (await env.ARXR.head(userKey))
        throw new HttpError(409, 'Аккаунт с таким email уже существует.');

    let projectId;
    let deviceToken;
    const adoptable = await validDevice(env, device);
    if (adoptable && (!adoptable.ownerEmailHash || adoptable.ownerEmailHash === emailHash)) {
        adoptable.ownerEmailHash = emailHash;
        await putJson(env.ARXR, keys.project(adoptable.projectId), adoptable);
        projectId = adoptable.projectId;
        deviceToken = device.deviceToken;
    }
    else {
        const created = await createProject(env, now, emailHash);
        projectId = created.record.projectId;
        deviceToken = created.deviceToken;
    }

    const user = {
        email,
        emailHash,
        password: await hashPassword(password),
        projectId,
        deviceToken,
        createdAt: new Date(now).toISOString()
    };
    await putJson(env.ARXR, userKey, user);
    const token = await createSession(env, emailHash, now);
    return accountView(user, token);
}

async function recentFailures(env, emailHash, now) {
    const doc = await getJson(env.ARXR, keys.throttle(emailHash));
    const list = Array.isArray(doc?.failures) ? doc.failures : [];
    return list.filter(t => Number.isFinite(t) && now - t < THROTTLE_WINDOW_MS);
}

export async function login(env, { email, password, device }, now) {
    const emailHash = await emailHashOf(email);
    const failures = await recentFailures(env, emailHash, now);
    if (failures.length >= THROTTLE_MAX_FAILURES)
        throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут.', { 'Retry-After': '900' });

    const user = await getJson(env.ARXR, keys.user(emailHash));
    if (!user || !(await verifyPassword(password, user.password))) {
        failures.push(now);
        await putJson(env.ARXR, keys.throttle(emailHash), { failures });
        throw new HttpError(401, 'Неверный email или пароль.');
    }
    if (failures.length > 0)
        await env.ARXR.delete(keys.throttle(emailHash));

    await ensureAccountProject(env, user, now);

    let mergedRooms = 0;
    const source = await validDevice(env, device);
    if (source && source.projectId !== user.projectId)
        mergedRooms = await mergeRooms(env, source.projectId, user.projectId);

    const token = await createSession(env, emailHash, now);
    return accountView(user, token, { mergedRooms });
}

function bearer(request) {
    const header = request.headers.get('Authorization') ?? '';
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
    return match ? match[1] : null;
}

/** Пользователь по Bearer-токену или 401. */
export async function requireUser(env, request, now) {
    const token = bearer(request);
    if (!token)
        throw new HttpError(401, 'Нужен вход.');
    const sessionKey = keys.session(await sha256Hex(token));
    const session = await getJson(env.ARXR, sessionKey);
    if (!session || !(session.exp > now)) {
        if (session)
            await env.ARXR.delete(sessionKey);
        throw new HttpError(401, 'Сессия недействительна.');
    }
    const user = await getJson(env.ARXR, keys.user(session.emailHash));
    if (!user)
        throw new HttpError(401, 'Сессия недействительна.');
    return { user, sessionKey };
}

export async function me(env, request, now) {
    const { user } = await requireUser(env, request, now);
    await ensureAccountProject(env, user, now);
    return { email: user.email, project: { projectId: user.projectId, deviceToken: user.deviceToken } };
}

export async function logout(env, request) {
    const token = bearer(request);
    if (!token)
        throw new HttpError(401, 'Нужен вход.');
    await env.ARXR.delete(keys.session(await sha256Hex(token)));
}
