# Iter 1 — Фикс удаления чата

## Диагноз

`DELETE /api/chats/:id` возвращал `400 FST_ERR_CTP_EMPTY_JSON_BODY`.
Причина: `getHeaders()` в `client/src/services/api.ts` всегда выставлял
`Content-Type: application/json`, даже для запросов без тела.
Fastify 5 при наличии этого заголовка обязан прочитать JSON-тело; пустое тело —
ошибка на уровне фреймворка, не бизнес-логики.

## Что изменено

- `client/src/services/api.ts:5` — добавлен параметр `withContentType = true`
  в `getHeaders()`; `Content-Type` добавляется только когда `withContentType` равен
  `true`.
- `client/src/services/api.ts:28` — `api.get` вызывает `getHeaders(false)` — GET
  тоже не отправлял тело, хотя Fastify GET не парсит, для чистоты исправлено.
- `client/src/services/api.ts:45` — `api.delete` вызывает `getHeaders(false)` —
  основной фикс.
- `api.post` и `api.patch` оставлены без изменений (`getHeaders()` со значением
  по умолчанию `true`), они отправляют JSON-тело и заголовок обязателен.

## Почему именно так

Минимальное изменение: одна дополнительная строка в `getHeaders` и по одному
исправленному вызову. Не вводится новая функция, не переписывается api-слой.
Параметр с дефолтом `true` гарантирует, что все будущие методы с телом получат
`Content-Type` автоматически, если явно не передать `false`.

## Проверки

- `tsc --noEmit`: ok (нет ошибок типов)
- Логика POST/PATCH не затронута — `Content-Type: application/json` по-прежнему
  присутствует.
- GET больше не отправляет лишний заголовок (не вызывал ошибку, но было некорректно).
