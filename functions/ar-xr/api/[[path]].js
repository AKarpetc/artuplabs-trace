// Cloudflare Pages Function: все маршруты /ar-xr/api/*.
import { handleApi } from '../_lib/router.js';

export function onRequest(context) {
    return handleApi(context.request, context.env);
}
