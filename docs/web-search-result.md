# Результат: Web search + цитаты

План — `web-search-plan.md`. Здесь — что фактически сделано по этапам.

## Этап 0 — доступ к Yandex Search API v2

- SA `ajepn79g4psakc0u6f2a` (`ai-studio-e5b0ee`), роль `search-api.webSearch.user`.
- Отдельный API-ключ `aje64vb6rbt3o4100tt8` (scope `yc.search-api.execute`) → `YC_SEARCH_API_KEY` в `server/.env`.
- Проверка `curl` к `/v2/web/search` — валидный XML.

## Этап 1 — поиск работает изолированно

- `server/src/services/search.ts` — функция `webSearch(query, signal?): Promise<Source[]>`. Тип `Source` локально (на этапе 2 переедет в `shared/types.ts`).
- Добавлена зависимость `fast-xml-parser` в `server/package.json`.
- Расхождение с планом: `<hlword>` режется **до** парсинга XML — `fast-xml-parser` ломает inline mixed-content внутри `<title>`/`<passage>`. Зафиксировано в плане.
- Ручной тест (`npx tsx --env-file=.env -e "..."`) вернул 5 источников; у 3 из 5 непустой snippet (норма для MVP).
- Лог ошибок — `console.error`. На этапе 2 в роуте можно прокинуть `fastify.log`.

## Этап 2 — бэк отдаёт sources в стрим

Изменённые файлы:
- `shared/types.ts` — добавлен `interface Source`, поле `Message.sources?: Source[]`, вариант SSE `{ type: 'sources'; sources: Source[] }`.
- `server/src/types.ts` — реэкспорт `Source`.
- `server/src/services/search.ts` — локальный `interface Source` удалён, теперь импортируется из `../../../shared/types.js` и реэкспортируется.
- `server/src/db/schema.ts` — таблица `sources` (cascade на `messages.id`, индекс `idx_sources_message_id`).
- `server/src/db/migrate.ts` — соответствующий `CREATE TABLE IF NOT EXISTS sources` + индекс.
- `server/src/routes/messages.ts`:
  - В `streamBodySchema` — `webSearch: z.boolean().optional()`.
  - До открытия SSE: если `webSearch === true`, синхронно выполняется `webSearch(userContent, abort.signal)`. AbortController создан раньше, чтобы передать его signal в поиск.
  - Промпт-аддон формируется через `buildSearchPromptBlock`: «Используй источники… [N] {title} ({url})\n{snippet}». Если sources пустые и тогл включён — вместо блока вставляется заметка `NO_RESULTS_NOTE` («Поиск не дал результатов или временно недоступен. Отвечай по своим знаниям.»). Конкатенация: сначала пользовательский `systemPrompt`, затем блок.
  - Первый SSE-эвент при `webSearch === true` — `{ type: 'sources', sources }` (даже пустой массив).
  - После сохранения assistant-сообщения — bulk-insert sources только если массив непустой.
  - `GET /api/chats/:chatId/messages` — отдельным запросом `inArray(sources.messageId, ids)` подтягивает источники, группирует по `messageId`, сортирует по `position`, прикрепляет к `Message.sources` (поле выставляется только если есть хотя бы один источник).
  - Ошибки поиска — `request.log.warn`.

Проверка:
- `cd server && npx tsc --noEmit` — без ошибок.
- `cd client && npx tsc --noEmit` — без ошибок. Клиент использует if-цепочки по `event.type` без exhaustiveness-проверки, поэтому новый вариант SSE-юниона ничего не ломает; на этапе 3 в `client/src/services/stream.ts` нужно будет добавить ветку `event.type === 'sources'` и колбэк `onSources`.
- `curl` к `/api/chats/:id/messages/stream` с `{"webSearch":true}` — первый фрейм `data: {"type":"sources","sources":[5 элементов]}`, далее `delta`, в финале `done`. Без `webSearch` — `sources`-эвент не шлётся.
- `GET /api/chats/:id/messages` после стрима возвращает assistant-сообщение с массивом `sources` (отсортированным по `position`). Модель в ответе расставила маркеры `[1]`, `[4]` корректно.

Расхождения с планом:
- В edge case «401 от Yandex» план предлагал отдельный `{ type: 'error', code: 'auth' }`. Сервис `webSearch` не различает 401 от других ошибок и всегда возвращает `[]`. Я не стал поднимать разделение — пустой массив + флаг тогла единообразно обрабатывается через `NO_RESULTS_NOTE`. Можно вынести как улучшение в `TODO.md` отдельно, если понадобится.

Что отвалится во фронте на этапе 3:
- Ничего не сломано прямо сейчас. На этапе 3 нужно: `streamBodySchema` уже принимает `webSearch`, фронт должен начать его слать; в `stream.ts` добавить ветку `event.type === 'sources'` и колбэк `onSources`; в `streamStore` копить `partialSources` и подкладывать в `appendMessage` на `done`.
