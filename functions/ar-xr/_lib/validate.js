// Строгая проверка входных данных API.

import { badRequest, cleanText } from './http.js';

export const LIMITS = {
    roomsPerProject: 200,
    modelsPerLayout: 200,
    nameLength: 80,
    modelIdLength: 300,
    quoteItems: 200,
    maxQty: 999
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODEL_PATH_RE = /^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;

export function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

/** Путь модели библиотеки: сегменты [A-Za-z0-9._~-], без '.' и '..'. */
export function isModelPath(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= LIMITS.modelIdLength
        && MODEL_PATH_RE.test(value)
        && !value.split('/').some(s => s === '.' || s === '..');
}

function modelId(value, where) {
    const id = typeof value === 'string' ? value : null;
    if (!id || id.length > LIMITS.modelIdLength || /[\u0000-\u001f\u007f]/.test(id))
        throw badRequest(`${where}: modelId должен быть непустой строкой до ${LIMITS.modelIdLength} символов.`);
    return id;
}

export function parseRoomName(value, { required }) {
    if (value === undefined || value === null) {
        if (required)
            throw badRequest('Нужно имя комнаты.');
        return null;
    }
    const name = cleanText(value, LIMITS.nameLength);
    if (!name)
        throw badRequest(`Имя комнаты — непустая строка до ${LIMITS.nameLength} символов.`);
    return name;
}

/** @returns {Array<{modelId: string, matrix: number[]}>} */
export function parseLayout(body) {
    const models = body.models;
    if (!Array.isArray(models))
        throw badRequest('Поле models должно быть массивом.');
    if (models.length > LIMITS.modelsPerLayout)
        throw badRequest(`В комнате не больше ${LIMITS.modelsPerLayout} моделей.`);
    return models.map((m, i) => {
        if (!m || typeof m !== 'object' || Array.isArray(m))
            throw badRequest(`models[${i}] должен быть объектом.`);
        const id = modelId(m.modelId, `models[${i}]`);
        const matrix = m.matrix;
        if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(v => typeof v === 'number' && Number.isFinite(v)))
            throw badRequest(`models[${i}].matrix — ровно 16 конечных чисел.`);
        return { modelId: id, matrix: [...matrix] };
    });
}

/** `{ items:[{modelId, qty?}] }` или `{ models:[{modelId}] }` → `[{modelId, qty}]`. */
export function parseQuoteItems(body) {
    let source;
    let fromItems;
    if (Array.isArray(body.items)) {
        source = body.items;
        fromItems = true;
    }
    else if (Array.isArray(body.models)) {
        source = body.models;
        fromItems = false;
    }
    else {
        throw badRequest('Нужен массив items или models.');
    }
    if (source.length > LIMITS.quoteItems)
        throw badRequest(`Не больше ${LIMITS.quoteItems} позиций.`);
    return source.map((it, i) => {
        const where = `${fromItems ? 'items' : 'models'}[${i}]`;
        if (!it || typeof it !== 'object' || Array.isArray(it))
            throw badRequest(`${where} должен быть объектом.`);
        const id = modelId(it.modelId, where);
        let qty = 1;
        if (fromItems && it.qty !== undefined && it.qty !== null) {
            if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > LIMITS.maxQty)
                throw badRequest(`${where}.qty — целое от 1 до ${LIMITS.maxQty}.`);
            qty = it.qty;
        }
        return { modelId: id, qty };
    });
}

const EMAIL_RE = /^[^\s@"<>()\[\]\\,;:]+@[^\s@"<>()\[\]\\,;:]+\.[^\s@"<>()\[\]\\,;:]{2,}$/;

export function parseCredentials(body) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL_RE.test(email))
        throw badRequest('Некорректный email.');
    const password = body.password;
    if (typeof password !== 'string' || password.length < 8)
        throw badRequest('Пароль — не короче 8 символов.');
    if (password.length > 256)
        throw badRequest('Пароль слишком длинный.');
    let device = null;
    if (body.device !== undefined && body.device !== null) {
        const d = body.device;
        if (!d || typeof d !== 'object' || typeof d.projectId !== 'string' || typeof d.deviceToken !== 'string')
            throw badRequest('device — { projectId, deviceToken }.');
        device = { projectId: d.projectId, deviceToken: d.deviceToken };
    }
    return { email, password, device };
}

const SETTINGS_FIELDS = new Set(['name', 'priceUsd', 'hidden', 'xrScale']);

/** Патч настроек модели: значение null удаляет поле. */
export function parseModelSettingsPatch(body) {
    const patch = {};
    for (const [k, v] of Object.entries(body)) {
        if (!SETTINGS_FIELDS.has(k))
            throw badRequest(`Неизвестное поле ${k}.`);
        if (v === null) {
            patch[k] = null;
            continue;
        }
        switch (k) {
            case 'name': {
                const name = cleanText(v, 120);
                if (!name)
                    throw badRequest('name — непустая строка до 120 символов.');
                patch.name = name;
                break;
            }
            case 'priceUsd':
                if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1_000_000)
                    throw badRequest('priceUsd — число от 0 до 1 000 000.');
                patch.priceUsd = Math.round(v * 100) / 100;
                break;
            case 'hidden':
                if (typeof v !== 'boolean')
                    throw badRequest('hidden — true или false.');
                patch.hidden = v;
                break;
            case 'xrScale':
                if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 10)
                    throw badRequest('xrScale — число больше 0 и не больше 10.');
                patch.xrScale = v;
                break;
        }
    }
    return patch;
}
