// Цены, имена моделей и расчёт сметы (Quote).
// prices.json и manifest.json — статика из ASSETS; кэшируются в изоляте на 5 минут.

import { HttpError } from './http.js';
import { getJson, keys } from './store.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
export const PRICES_PATH = '/ar-xr/data/prices.json';
export const MANIFEST_PATH = '/ar-xr/data/manifest.json';

const cache = new Map();

/** Только для тестов: сбросить кэш изолята. */
export function resetCatalogCache() {
    cache.clear();
}

async function loadAsset(env, baseUrl, path, now) {
    const hit = cache.get(path);
    if (hit && now - hit.at < CACHE_TTL_MS)
        return hit.value;
    const response = await env.ASSETS.fetch(new Request(new URL(path, baseUrl)));
    if (!response.ok)
        throw new Error(`ASSETS ${path} → ${response.status}`);
    const value = await response.json();
    cache.set(path, { at: now, value });
    return value;
}

export async function loadPrices(env, baseUrl, now) {
    try {
        const doc = await loadAsset(env, baseUrl, PRICES_PATH, now);
        if (!doc || typeof doc.prices !== 'object' || !doc.rates)
            throw new Error('prices.json без prices/rates');
        return doc;
    }
    catch {
        throw new HttpError(503, 'Цены временно недоступны.');
    }
}

/** Карта path → {name, nameRu} из демо-манифеста; при ошибке — пустая (имена не критичны). */
export async function loadModelNames(env, baseUrl, now) {
    try {
        const manifest = await loadAsset(env, baseUrl, MANIFEST_PATH, now);
        const names = new Map();
        for (const m of Array.isArray(manifest?.models) ? manifest.models : []) {
            if (m && typeof m.path === 'string')
                names.set(m.path, {
                    name: typeof m.name === 'string' ? m.name : m.path,
                    nameRu: typeof m.nameRu === 'string' ? m.nameRu : null
                });
        }
        return names;
    }
    catch {
        return new Map();
    }
}

export async function loadModelSettings(env) {
    const doc = await getJson(env.ARXR, keys.modelSettings());
    if (!doc || typeof doc.models !== 'object' || doc.models === null || Array.isArray(doc.models))
        return { updatedAt: doc?.updatedAt ?? null, models: {} };
    return doc;
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {Array<{modelId: string, qty: number}>} items уже провалидированные позиции
 * @returns {Promise<object>} Quote
 */
export async function computeQuote(env, baseUrl, items, now) {
    const [prices, names, settings] = await Promise.all([
        loadPrices(env, baseUrl, now),
        loadModelNames(env, baseUrl, now),
        loadModelSettings(env)
    ]);

    const merged = new Map();
    for (const { modelId, qty } of items)
        merged.set(modelId, (merged.get(modelId) ?? 0) + qty);

    const lines = [];
    const missing = [];
    let totalUsd = 0;
    for (const [modelId, qty] of merged) {
        const override = Object.hasOwn(settings.models, modelId) ? settings.models[modelId] ?? {} : {};
        const listed = Object.hasOwn(prices.prices, modelId) ? prices.prices[modelId] : undefined;
        const unit = Number.isFinite(override.priceUsd) ? override.priceUsd
            : Number.isFinite(listed) ? listed : null;
        if (unit === null) {
            missing.push(modelId);
            continue;
        }
        const ownerName = typeof override.name === 'string' && override.name ? override.name : null;
        const listedName = names.get(modelId);
        const name = ownerName ?? listedName?.name ?? modelId;
        const nameRu = ownerName ?? listedName?.nameRu ?? name;
        const lineTotal = round2(unit * qty);
        totalUsd += lineTotal;
        lines.push({ modelId, name, nameRu, qty, unitUsd: round2(unit), totalUsd: lineTotal });
    }

    const rates = prices.rates;
    const usd = round2(totalUsd);
    return {
        currency: 'USD',
        lines,
        missing,
        totals: {
            USD: usd,
            KZT: Math.round(usd * Number(rates.KZT)),
            RUB: Math.round(usd * Number(rates.RUB))
        },
        rates: { date: rates.date ?? null, source: rates.source ?? null, KZT: rates.KZT, RUB: rates.RUB },
        computedAt: new Date(now).toISOString()
    };
}
