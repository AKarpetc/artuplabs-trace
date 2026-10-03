// Криптографические примитивы на Web Crypto: работают и в Workers, и в Node 22.

const encoder = new TextEncoder();

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export function bytesToHex(bytes) {
    let out = '';
    for (const b of new Uint8Array(bytes))
        out += b.toString(16).padStart(2, '0');
    return out;
}

export function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex))
        throw new Error('invalid hex');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

export function bytesToBase64Url(bytes) {
    let bin = '';
    for (const b of new Uint8Array(bytes))
        bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    return bytesToHex(digest);
}

/** Случайный токен: 32 байта, base64url (43 символа). */
export function randomToken(byteLength = 32) {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/**
 * Сравнение строк за время, не зависящее от позиции первого расхождения.
 * Длина не секретна (сравниваются хэши фиксированной длины или токены известного формата).
 */
export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    const ab = encoder.encode(a);
    const bb = encoder.encode(b);
    if (ab.length !== bb.length)
        return false;
    let diff = 0;
    for (let i = 0; i < ab.length; i++)
        diff |= ab[i] ^ bb[i];
    return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
    return bytesToHex(bits);
}

/** @returns {Promise<{alg: string, iterations: number, salt: string, hash: string}>} */
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return { alg: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: bytesToHex(salt), hash };
}

export async function verifyPassword(password, record) {
    if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string')
        return false;
    const iterations = Number.isInteger(record.iterations) ? record.iterations : PBKDF2_ITERATIONS;
    const hash = await pbkdf2(password, hexToBytes(record.salt), iterations);
    return timingSafeEqual(hash, record.hash);
}
