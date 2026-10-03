// Cloudflare Pages Function: прокси библиотеки моделей /ar-xr/library/*.
import { handleLibrary } from '../_lib/library.js';

export function onRequest(context) {
    return handleLibrary(context.request, context.env, { waitUntil: p => context.waitUntil(p) });
}
