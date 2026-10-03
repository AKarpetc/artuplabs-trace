# ArtUp AR XR — Pages Functions

Бэкенд демо `https://artuplabs.com/ar-xr/`: Cloudflare Pages Functions, ES-модули, без npm-зависимостей
(только Web API). Спецификация — `projects/AR_XR/temp/plans/2026-10-03_artuplabs-ar-xr-demo.md`.

## Маршруты

- `api/[[path]].js` → `/ar-xr/api/*` — роутер `_lib/router.js`.
- `library/[[path]].js` → `/ar-xr/library/*` — прокси библиотеки `_lib/library.js`.
- `_lib/` — логика (не маршруты: модули без `onRequest`), тестируется с подставным env.

## Привязки

| Имя | Что |
|---|---|
| `ARXR` | R2-бакет `artuplabs-ar-xr` |
| `ASSETS` | статика Pages (`/ar-xr/data/prices.json`, `/ar-xr/data/manifest.json`) |
| `ARXR_ADMIN_TOKEN` | секрет демо-админа; нет секрета → admin-эндпоинты отвечают 503 |

## Ключи R2

| Ключ | Содержимое |
|---|---|
| `projects/<projectId>.json` | `{ projectId, name, tokenHash (sha256 hex токена устройства), createdAt, ownerEmailHash? }` |
| `rooms/<projectId>/<roomId>.json` | комната и расстановка одним объектом: `{ roomId, name, createdAt, updatedAt, itemCount, quote, models:[{modelId, matrix[16]}] }`; список комнат — `list({prefix})` + чтение объектов (≤ 200) |
| `users/<sha256(email)>.json` | `{ email, emailHash, password:{alg, iterations:100000, salt, hash}, projectId, deviceToken, createdAt }` |
| `sessions/<sha256(token)>.json` | `{ emailHash, exp }` (мс, 30 дней) |
| `throttle/<sha256(email)>.json` | `{ failures:[ms…] }` — неудачные входы за 15 минут; 10 → 429 |
| `settings/models.json` | `{ updatedAt, models:{ "<path>": { name?, priceUsd?, hidden?, xrScale? } } }` |
| `library/<path>` | кэш файлов библиотеки (write-through с Yandex-origin) |

## API (`/ar-xr/api`)

Ошибки — `{ title, status }`. 400 — валидация, 403 — неверный `X-Device-Token`, 404 — нет проекта/комнаты,
405 — метод (с `Allow`), 409 — дубликат email / лимит 200 комнат, 413 — тело > 256 КБ, 415 — не JSON,
429 — throttle, 503 — нет цен / нет секрета админа. `OPTIONS` → 204.

- `POST /projects`, `GET /projects/:p`, `GET|POST /projects/:p/rooms`, `GET|PUT|DELETE /projects/:p/rooms/:r`,
  `GET|PUT /projects/:p/rooms/:r/layout` (PUT пересчитывает `quote` и `itemCount`).
- `GET /public/projects/:p/rooms/:r`, `GET /public/projects/:p/rooms/:r/layout`, `GET /public/projects/:p/models` → `[]`.
- `POST /quote`.
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`.
- `GET /model-settings`, `PUT|DELETE /model-settings/:modelPath` (`X-Admin-Token`), `GET /admin/check`.

Ответ о проекте содержит и `projectId`, и `id`: существующий клиент (`deviceProject.js`) читает `created.id`.

## Тесты

```sh
npm run test:ar-xr        # node --test "functions-tests/ar-xr/*.test.mjs"
npx wrangler@4 pages functions build --outdir <tmp>   # проверка сборки
```
