// In-memory заменители R2-привязки и ASSETS для node --test.

async function toBytes(value) {
    if (value === null || value === undefined)
        return new Uint8Array(0);
    if (typeof value === 'string')
        return new TextEncoder().encode(value);
    if (value instanceof Uint8Array)
        return new Uint8Array(value);
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value))
        return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    if (value instanceof ReadableStream || value instanceof Blob)
        return new Uint8Array(await new Response(value).arrayBuffer());
    throw new Error(`unsupported put body ${typeof value}`);
}

export class MemoryR2 {
    constructor() {
        this.objects = new Map();
        this.ops = [];
    }

    #meta(key, entry) {
        return {
            key,
            size: entry.bytes.byteLength,
            httpMetadata: { ...entry.httpMetadata },
            httpEtag: `"${entry.etag}"`,
            uploaded: entry.uploaded
        };
    }

    async put(key, value, options = {}) {
        this.ops.push(['put', key]);
        const bytes = await toBytes(value);
        this.objects.set(key, {
            bytes,
            httpMetadata: options.httpMetadata ?? {},
            etag: `e${this.ops.length}`,
            uploaded: new Date()
        });
        return this.#meta(key, this.objects.get(key));
    }

    async get(key) {
        this.ops.push(['get', key]);
        const entry = this.objects.get(key);
        if (!entry)
            return null;
        const bytes = entry.bytes;
        return {
            ...this.#meta(key, entry),
            body: new Response(bytes).body,
            async arrayBuffer() { return bytes.slice().buffer; },
            async text() { return new TextDecoder().decode(bytes); },
            async json() { return JSON.parse(new TextDecoder().decode(bytes)); }
        };
    }

    async head(key) {
        this.ops.push(['head', key]);
        const entry = this.objects.get(key);
        return entry ? this.#meta(key, entry) : null;
    }

    async delete(key) {
        this.ops.push(['delete', key]);
        for (const k of Array.isArray(key) ? key : [key])
            this.objects.delete(k);
    }

    async list({ prefix = '', cursor, limit = 1000 } = {}) {
        const all = [...this.objects.keys()].filter(k => k.startsWith(prefix)).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + limit);
        const next = start + page.length;
        return {
            objects: page.map(k => this.#meta(k, this.objects.get(k))),
            truncated: next < all.length,
            cursor: next < all.length ? String(next) : undefined,
            delimitedPrefixes: []
        };
    }

    readJson(key) {
        const entry = this.objects.get(key);
        return entry ? JSON.parse(new TextDecoder().decode(entry.bytes)) : null;
    }

    keysWithPrefix(prefix) {
        return [...this.objects.keys()].filter(k => k.startsWith(prefix));
    }
}

/** ASSETS: отдаёт JSON по pathname; считает обращения. */
export class MemoryAssets {
    constructor(files = {}) {
        this.files = new Map(Object.entries(files));
        this.calls = [];
    }

    async fetch(input) {
        const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), 'https://artuplabs.com');
        this.calls.push(url.pathname);
        if (!this.files.has(url.pathname))
            return new Response('not found', { status: 404 });
        const value = this.files.get(url.pathname);
        return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export const PRICES = {
    currency: 'USD',
    source: 'test',
    rates: { date: '2026-10-03', source: 'open.er-api.com', KZT: 444.08, RUB: 83.5 },
    prices: {
        'living/sofa-a': 399.99,
        'living/chair-b': 49.5,
        'kitchen/table-c': 120
    }
};

export const MANIFEST = {
    version: 1,
    models: [
        { id: 'ikea:1', path: 'living/sofa-a', name: 'Sofa A' },
        { id: 'ikea:2', path: 'living/chair-b', name: 'Chair B' },
        { id: 'ikea:3', path: 'kitchen/table-c', name: 'Table C' }
    ]
};

export function makeEnv(extra = {}) {
    return {
        ARXR: new MemoryR2(),
        ASSETS: new MemoryAssets({ '/ar-xr/data/prices.json': PRICES, '/ar-xr/data/manifest.json': MANIFEST }),
        ...extra
    };
}

export function makeClock(start = Date.parse('2026-10-03T10:00:00Z')) {
    const clock = { t: start, now: () => clock.t, advance(ms) { clock.t += ms; } };
    return clock;
}
