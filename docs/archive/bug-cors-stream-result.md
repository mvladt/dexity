# Bug: CORS-заголовок отсутствует в SSE-ответе стриминга

**Дата:** 2026-05-07  
**Severity:** Critical — стриминг полностью не работает в браузере

---

## Симптом

При отправке сообщения в чате браузер блокирует запрос:

```
Access to fetch at 'http://localhost:3001/api/chats/1/messages/stream'
from origin 'http://localhost:5173' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Причина

`server/src/routes/messages.ts`, строка 79 — SSE-ответ открывается через `reply.raw.writeHead()`:

```ts
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
});
```

`reply.raw.writeHead()` обходит Fastify и его CORS-плагин (`@fastify/cors`).  
Плагин добавляет `Access-Control-Allow-Origin` через Fastify-хуки, но они уже не успевают — заголовки отправлены напрямую в Node.js-сокет.

## Проверка

Preflight (`OPTIONS`) работает корректно — `@fastify/cors` его обрабатывает до `writeHead`.  
Обычные JSON-эндпоинты (`GET /api/chats`) — CORS работает нормально.  
curl-запрос к стриминговому эндпоинту — данные приходят, но `Access-Control-Allow-Origin` в ответных заголовках **отсутствует**.

## Ожидаемое поведение

Ответ стримингового эндпоинта должен содержать:

```
Access-Control-Allow-Origin: http://localhost:5173
```

## Предлагаемое решение

Добавить CORS-заголовок вручную в `writeHead`, рядом с остальными SSE-заголовками:

```ts
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Access-Control-Allow-Origin': config.CORS_ORIGIN,
});
```

## Затронутые файлы

- `server/src/routes/messages.ts` — строка 79
