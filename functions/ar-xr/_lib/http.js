// HTTP-хелперы: JSON-ответы, ошибки в форме { title, status }, чтение тела с лимитом.

export const MAX_BODY_BYTES = 256 * 1024;

export class HttpError extends Error {
    constructor(status, title, headers = undefined) {
        super(title);
        this.status = status;
        this.title = title;
        this.headers = headers;
    }
}

export function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...extraHeaders
        }
    });
}

export function problem(status, title, extraHeaders = {}) {
    return json({ title, status }, status, extraHeaders);
}

export function noContent() {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function badRequest(title) {
    return new HttpError(400, title);
}

/**
 * Читает JSON-тело запроса не больше `maxBytes`. Пустое тело → `{}`.
 * Непустое тело обязано иметь Content-Type application/json.
 */
export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
    const declared = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > maxBytes)
        throw new HttpError(413, 'Тело запроса слишком большое.');

    const bytes = await readLimited(request.body, maxBytes);
    if (bytes.length === 0)
        return {};

    const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
    if (!contentType.includes('application/json'))
        throw new HttpError(415, 'Ожидается Content-Type: application/json.');

    let data;
    try {
        data = JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        throw badRequest('Тело запроса не является корректным JSON.');
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        throw badRequest('Тело запроса должно быть JSON-объектом.');
    return data;
}

async function readLimited(stream, maxBytes) {
    if (!stream)
        return new Uint8Array(0);
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new HttpError(413, 'Тело запроса слишком большое.');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

export function methodNotAllowed(allowed) {
    return new HttpError(405, 'Метод не поддерживается.', { Allow: allowed.join(', ') });
}

/** Строка без управляющих символов, обрезанная, длиной 1..max. */
export function cleanText(value, max) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed))
        return null;
    return trimmed;
}
