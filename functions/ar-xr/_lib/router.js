// Маршрутизатор /ar-xr/api/*. Вся логика — в модулях _lib, сюда приходят только
// разбор пути, проверка метода и сборка ответа.

import { HttpError, json, methodNotAllowed, noContent, problem, readJson } from './http.js';
import { computeQuote } from './catalog.js';
import {
    createProject, createRoom, deleteRoom, layoutView, listRooms, projectView, renameRoom,
    requireProject, requireRoom, requireWriter, roomView, saveLayout
} from './projects.js';
import { login, logout, me, register } from './auth.js';
import { createHandoff, redeemHandoff } from './handoff.js';
import { getSettings, patchModel, removeModel, requireAdmin } from './settings.js';
import { isModelPath, parseCredentials, parseLayout, parseModelSettingsPatch, parseQuoteItems, parseRoomName } from './validate.js';

export const API_BASE = '/ar-xr/api';

function allow(method, allowed) {
    if (!allowed.includes(method))
        throw methodNotAllowed(allowed);
}

function segmentsOf(pathname) {
    if (!pathname.startsWith(API_BASE + '/') && pathname !== API_BASE)
        return null;
    const rest = pathname.slice(API_BASE.length).replace(/^\/+/, '').replace(/\/+$/, '');
    return rest === '' ? [] : rest.split('/');
}

function decode(segment) {
    try {
        return decodeURIComponent(segment);
    }
    catch {
        throw new HttpError(400, 'Некорректный путь.');
    }
}

/**
 * @param {Request} request
 * @param {object} env  { ARXR: R2Bucket, ASSETS: Fetcher, ARXR_ADMIN_TOKEN?: string }
 * @param {{now?: () => number}} [deps]
 */
export async function handleApi(request, env, deps = {}) {
    const clock = deps.now ?? Date.now;
    try {
        if (request.method === 'OPTIONS')
            return noContent();
        if (!env?.ARXR)
            throw new HttpError(503, 'Хранилище не подключено.');
        const url = new URL(request.url);
        const raw = segmentsOf(url.pathname);
        if (raw === null)
            throw new HttpError(404, 'Не найдено.');
        return await route(request, env, url, raw, clock);
    }
    catch (err) {
        if (err instanceof HttpError)
            return problem(err.status, err.title, err.headers);
        console.error('ar-xr api error', err);
        return problem(500, 'Внутренняя ошибка сервиса.');
    }
}

async function route(request, env, url, raw, clock) {
    const m = request.method;
    const seg = raw.map(decode);
    const [a, b, c, d, e, f] = seg;
    const n = seg.length;

    // /api/projects ...
    if (a === 'projects') {
        if (n === 1) {
            allow(m, ['POST']);
            await readJson(request);
            const { record, deviceToken } = await createProject(env, clock());
            return json(projectView(record, deviceToken), 201);
        }
        if (n === 2) {
            allow(m, ['GET']);
            return json(projectView(await requireProject(env, b)));
        }
        if (c === 'rooms') {
            if (n === 3) {
                allow(m, ['GET', 'POST']);
                if (m === 'GET') {
                    await requireProject(env, b);
                    return json(await listRooms(env, b));
                }
                await requireWriter(env, b, request);
                const body = await readJson(request);
                const room = await createRoom(env, b, parseRoomName(body.name, { required: false }), clock());
                return json(roomView(room), 201);
            }
            if (n === 4) {
                allow(m, ['GET', 'PUT', 'DELETE']);
                if (m === 'GET') {
                    await requireProject(env, b);
                    return json(roomView(await requireRoom(env, b, d)));
                }
                await requireWriter(env, b, request);
                if (m === 'DELETE') {
                    await deleteRoom(env, b, d);
                    return noContent();
                }
                const body = await readJson(request);
                const name = parseRoomName(body.name, { required: true });
                return json(roomView(await renameRoom(env, b, d, name, clock())));
            }
            if (n === 5 && e === 'layout') {
                allow(m, ['GET', 'PUT']);
                if (m === 'GET') {
                    await requireProject(env, b);
                    return json(layoutView(await requireRoom(env, b, d)));
                }
                await requireWriter(env, b, request);
                const models = parseLayout(await readJson(request));
                return json(roomView(await saveLayout(env, url, b, d, models, clock())));
            }
        }
    }

    // /api/public/projects/:p/...
    if (a === 'public' && b === 'projects' && n >= 4) {
        allow(m, ['GET']);
        const p = c;
        if (n === 4 && d === 'models') {
            await requireProject(env, p);
            return json([]);
        }
        if (d === 'rooms' && n === 5) {
            await requireProject(env, p);
            return json(roomView(await requireRoom(env, p, e)));
        }
        if (d === 'rooms' && n === 6 && f === 'layout') {
            await requireProject(env, p);
            return json(layoutView(await requireRoom(env, p, e)));
        }
    }

    if (a === 'quote' && n === 1) {
        allow(m, ['POST']);
        const items = parseQuoteItems(await readJson(request));
        return json(await computeQuote(env, url, items, clock()));
    }

    if (a === 'auth' && n === 2) {
        if (b === 'register') {
            allow(m, ['POST']);
            return json(await register(env, parseCredentials(await readJson(request)), clock()), 201);
        }
        if (b === 'login') {
            allow(m, ['POST']);
            return json(await login(env, parseCredentials(await readJson(request)), clock()));
        }
        if (b === 'me') {
            allow(m, ['GET']);
            return json(await me(env, request, clock()));
        }
        if (b === 'logout') {
            allow(m, ['POST']);
            await logout(env, request);
            return noContent();
        }
    }

    if (a === 'auth' && b === 'handoff' && n === 2) {
        allow(m, ['POST']);
        return json(await createHandoff(env, request, await readJson(request), clock()), 201);
    }
    if (a === 'auth' && b === 'handoff' && c === 'redeem' && n === 3) {
        allow(m, ['POST']);
        return json(await redeemHandoff(env, request, await readJson(request), clock()));
    }

    if (a === 'model-settings') {
        if (n === 1) {
            allow(m, ['GET']);
            return json(await getSettings(env));
        }
        // Путь модели может прийти как один сегмент с %2F или как несколько сегментов.
        const modelPath = seg.slice(1).join('/');
        allow(m, ['PUT', 'DELETE']);
        requireAdmin(env, request);
        if (!isModelPath(modelPath))
            throw new HttpError(400, 'Некорректный путь модели.');
        if (m === 'DELETE') {
            await removeModel(env, modelPath, clock());
            return noContent();
        }
        const patch = parseModelSettingsPatch(await readJson(request));
        return json(await patchModel(env, modelPath, patch, clock()));
    }

    if (a === 'admin' && b === 'check' && n === 2) {
        allow(m, ['GET']);
        requireAdmin(env, request);
        return noContent();
    }

    throw new HttpError(404, 'Не найдено.');
}
