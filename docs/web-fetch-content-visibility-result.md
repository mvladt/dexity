# Результат — видимость контента `web_fetch`

## Проблема

Плашка Fetch показывала только домен + зелёную галочку. Извлечённый readability
текст уходил в LLM, но **на фронт не отправлялся** — проверить, что реально
прочитала модель, было нельзя. Капча/заглушка (короткий мусорный текст) проходит
проверку `article.textContent?.trim()` и помечается как success — мусор под
зелёной галочкой, невидимый пользователю.

## Решение

Прокинуть извлечённый текст до UI и показать его в разворачиваемой плашке + длину
в заголовке. Короткое число символов = мгновенный сигнал мусора. Без авто-флага
(эвристик captcha) — ручная оценка по тексту и длине.

Решения (согласованы 2026-06-01):

- **Хранение:** пишем `content` в `toolData` (БД) — виден и после reload.
- **Детекция:** только контент + длина, без авто-флага.

## Что сделано

- [x] `shared/types.ts` — `content?: string` в `PartSnapshot` (fetch) и в SSE tool-событии.
- [x] `server/src/routes/messages.ts` — `content` в SSE на success и в `partsLog`.
- [x] `client/src/stores/streamStore.ts` — `content` в `ToolState` (fetch/success) и проброс в `onTool`.
- [x] `client/src/components/ChatStream.tsx` — `buildFetchPart`: заголовок «домен · N симв.»,
      тело `<pre>` с текстом, `autoCollapseOnSuccess`. Восстановление `content` из снапшота при reload.
- [x] `client/src/styles.css` — `.dx-fetch-header`, `.dx-fetch-len`, `.dx-fetch-content`.
- [x] `npx tsc --noEmit` чистый на server и client.

## Бюджет хранения

До 15 000 симв. × до 20 фетчей на сообщение (`CONTENT_MAX`, `MAX_FETCHES_PER_RESPONSE`).
SQLite тянет; БД растёт — приемлемо для личного использования.

## Связанное / не входит

- `docs/web-fetch-captcha-task.md` — серверная авто-детекция капчи (модель не
  получает мусор, не зацикливается). Дополняет эту фичу, остаётся открытой.
