// Проекты устройства и комнаты. Комната и её расстановка хранятся одним объектом
// rooms/<projectId>/<roomId>.json; наружу Room отдаётся без поля models.

import { randomToken, sha256Hex, timingSafeEqual } from './crypto.js';
import { HttpError } from './http.js';
import { getJson, keys, listKeys, putJson } from './store.js';
import { LIMITS, isUuid } from './validate.js';
import { computeQuote } from './catalog.js';

export const DEVICE_TOKEN_HEADER = 'X-Device-Token';

/** Ответ о проекте: `projectId` по спецификации и `id` для существующего клиента (deviceProject.js). */
export function projectView(record, deviceToken = undefined) {
    const view = { projectId: record.projectId, id: record.projectId, name: record.name ?? null };
    if (deviceToken !== undefined)
        view.deviceToken = deviceToken;
    return view;
}

export async function createProject(env, now, ownerEmailHash = null) {
    const projectId = crypto.randomUUID();
    const deviceToken = randomToken();
    const record = {
        projectId,
        name: null,
        tokenHash: await sha256Hex(deviceToken),
        createdAt: new Date(now).toISOString()
    };
    if (ownerEmailHash)
        record.ownerEmailHash = ownerEmailHash;
    await putJson(env.ARXR, keys.project(projectId), record);
    return { record, deviceToken };
}

export async function loadProject(env, projectId) {
    if (!isUuid(projectId))
        return null;
    return getJson(env.ARXR, keys.project(projectId));
}

export async function requireProject(env, projectId) {
    const record = await loadProject(env, projectId);
    if (!record)
        throw new HttpError(404, 'Проект не найден.');
    return record;
}

export async function tokenMatches(record, deviceToken) {
    if (!record || typeof deviceToken !== 'string' || deviceToken.length === 0 || deviceToken.length > 200)
        return false;
    return timingSafeEqual(await sha256Hex(deviceToken), record.tokenHash);
}

/** Проект с правом записи по заголовку X-Device-Token: 404 — нет проекта, 403 — токен не подошёл. */
export async function requireWriter(env, projectId, request) {
    const record = await requireProject(env, projectId);
    if (!(await tokenMatches(record, request.headers.get(DEVICE_TOKEN_HEADER))))
        throw new HttpError(403, 'Нет права записи в проект.');
    return record;
}

export function roomView(room) {
    return {
        roomId: room.roomId,
        name: room.name,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        itemCount: room.itemCount ?? 0,
        quote: room.quote ?? null,
        frame: room.frame ?? 'room'
    };
}

async function loadRoomRecord(env, projectId, roomId) {
    if (!isUuid(roomId))
        return null;
    return getJson(env.ARXR, keys.room(projectId, roomId));
}

export async function requireRoom(env, projectId, roomId) {
    const room = await loadRoomRecord(env, projectId, roomId);
    if (!room)
        throw new HttpError(404, 'Комната не найдена.');
    return room;
}

export async function listRoomRecords(env, projectId) {
    const roomKeys = await listKeys(env.ARXR, keys.roomPrefix(projectId));
    const rooms = await Promise.all(roomKeys.map(k => getJson(env.ARXR, k)));
    return rooms
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function listRooms(env, projectId) {
    return (await listRoomRecords(env, projectId)).map(roomView);
}

export async function createRoom(env, projectId, name, now) {
    const existing = await listKeys(env.ARXR, keys.roomPrefix(projectId));
    if (existing.length >= LIMITS.roomsPerProject)
        throw new HttpError(409, `В проекте не больше ${LIMITS.roomsPerProject} комнат.`);
    const at = new Date(now).toISOString();
    const room = {
        roomId: crypto.randomUUID(),
        name: name ?? `Комната ${existing.length + 1}`,
        createdAt: at,
        updatedAt: at,
        itemCount: 0,
        quote: null,
        models: []
    };
    await putJson(env.ARXR, keys.room(projectId, room.roomId), room);
    return room;
}

export async function renameRoom(env, projectId, roomId, name, now) {
    const room = await requireRoom(env, projectId, roomId);
    room.name = name;
    room.updatedAt = new Date(now).toISOString();
    await putJson(env.ARXR, keys.room(projectId, roomId), room);
    return room;
}

export async function deleteRoom(env, projectId, roomId) {
    await requireRoom(env, projectId, roomId);
    await env.ARXR.delete(keys.room(projectId, roomId));
}

/** Сохраняет расстановку и пересчитывает смету; недоступные цены не мешают сохранению (quote: null). */
export async function saveLayout(env, baseUrl, projectId, roomId, models, now, frame = 'room') {
    const room = await requireRoom(env, projectId, roomId);
    let quote = null;
    if (models.length > 0) {
        try {
            quote = await computeQuote(env, baseUrl, models.map(m => ({ modelId: m.modelId, qty: 1 })), now);
        }
        catch (err) {
            if (!(err instanceof HttpError))
                throw err;
        }
    }
    room.models = models;
    room.frame = frame;
    room.itemCount = models.length;
    room.quote = quote;
    room.updatedAt = new Date(now).toISOString();
    await putJson(env.ARXR, keys.room(projectId, roomId), room);
    return room;
}

export function layoutView(room) {
    return { roomId: room.roomId, frame: room.frame ?? 'room', models: Array.isArray(room.models) ? room.models : [] };
}

/**
 * Копирует комнаты (с расстановками) из одного проекта в другой, сохраняя roomId:
 * повторный вход с того же устройства не плодит дубликаты. Более свежая версия побеждает.
 * Лимит комнат целевого проекта соблюдается: лишние новые комнаты не копируются.
 * @returns {Promise<number>} сколько комнат записано
 */
export async function mergeRooms(env, fromProjectId, toProjectId) {
    const source = await listRoomRecords(env, fromProjectId);
    if (source.length === 0)
        return 0;
    const targetKeys = new Set(await listKeys(env.ARXR, keys.roomPrefix(toProjectId)));
    let count = targetKeys.size;
    let written = 0;
    for (const room of source) {
        const key = keys.room(toProjectId, room.roomId);
        if (targetKeys.has(key)) {
            const current = await getJson(env.ARXR, key);
            if (current && String(current.updatedAt) >= String(room.updatedAt))
                continue;
        }
        else {
            if (count >= LIMITS.roomsPerProject)
                continue;
            count++;
        }
        await putJson(env.ARXR, key, room);
        written++;
    }
    return written;
}
