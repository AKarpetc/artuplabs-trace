// Настройки моделей демо (settings/models.json) и проверка демо-токена администратора.

import { timingSafeEqual } from './crypto.js';
import { HttpError } from './http.js';
import { keys, putJson } from './store.js';
import { loadModelSettings } from './catalog.js';

export const ADMIN_TOKEN_HEADER = 'X-Admin-Token';

/** 503 — секрет не задан, 401 — токен не передан или неверен. */
export function requireAdmin(env, request) {
    const secret = env.ARXR_ADMIN_TOKEN;
    if (typeof secret !== 'string' || secret.length === 0)
        throw new HttpError(503, 'Администрирование не настроено.');
    const given = request.headers.get(ADMIN_TOKEN_HEADER) ?? '';
    if (!timingSafeEqual(given, secret))
        throw new HttpError(401, 'Неверный токен администратора.');
}

export async function getSettings(env) {
    return loadModelSettings(env);
}

export async function patchModel(env, modelPath, patch, now) {
    const doc = await loadModelSettings(env);
    const entry = { ...(doc.models[modelPath] ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
        if (v === null)
            delete entry[k];
        else
            entry[k] = v;
    }
    if (Object.keys(entry).length === 0)
        delete doc.models[modelPath];
    else
        doc.models[modelPath] = entry;
    doc.updatedAt = new Date(now).toISOString();
    await putJson(env.ARXR, keys.modelSettings(), doc);
    return entry;
}

export async function removeModel(env, modelPath, now) {
    const doc = await loadModelSettings(env);
    if (!(modelPath in doc.models))
        return;
    delete doc.models[modelPath];
    doc.updatedAt = new Date(now).toISOString();
    await putJson(env.ARXR, keys.modelSettings(), doc);
}
