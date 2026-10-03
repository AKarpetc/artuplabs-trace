// Обёртка над R2-привязкой: JSON-объекты и постраничный list.

export const keys = {
    project: id => `projects/${id}.json`,
    roomPrefix: projectId => `rooms/${projectId}/`,
    room: (projectId, roomId) => `rooms/${projectId}/${roomId}.json`,
    user: emailHash => `users/${emailHash}.json`,
    session: tokenHash => `sessions/${tokenHash}.json`,
    throttle: emailHash => `throttle/${emailHash}.json`,
    modelSettings: () => 'settings/models.json',
    library: path => `library/${path}`
};

export async function getJson(bucket, key) {
    const obj = await bucket.get(key);
    if (!obj)
        return null;
    try {
        return await obj.json();
    }
    catch {
        return null;
    }
}

export async function putJson(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' }
    });
}

/** Все ключи с префиксом (с учётом пагинации R2). */
export async function listKeys(bucket, prefix) {
    const out = [];
    let cursor;
    for (;;) {
        const page = await bucket.list({ prefix, cursor, limit: 1000 });
        for (const o of page.objects)
            out.push(o.key);
        if (!page.truncated)
            break;
        cursor = page.cursor;
    }
    return out;
}
