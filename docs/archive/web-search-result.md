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

## Этап 3 — фронт показывает блок «Источники»

Изменённые файлы:
- `client/src/types.ts` — добавлен реэкспорт `Source` из `@shared/types`.
- `client/src/stores/settingsStore.ts` — поле `webSearch: boolean` (default `false`) + `setWebSearch`. Персистится в `dexity-settings`.
- `client/src/components/ChatComposer.tsx` — добавлен `Switch` из `@gravity-ui/uikit` с лейблом «Web» рядом с `Select` модели; связан с `settingsStore.webSearch` / `setWebSearch`.
- `client/src/services/stream.ts` — в `StreamCallbacks` добавлены `onSources?: (sources: Source[]) => void` и `webSearch?: boolean`; тело POST дополнено `webSearch: true` (если включён); добавлена ветка `event.type === 'sources'`.
- `client/src/stores/streamStore.ts` — поле `partialSources: Source[]`; `webSearch` берётся из `settingsStore` и пробрасывается в `streamMessages`; `onSources` → `set({ partialSources })`; при старте и отмене — сброс в `[]`; в `onDone` — `sources: partialSources` подкладывается в `appendMessage` (только если непустой), после — сброс.
- `client/src/utils/citations.ts` — новый файл, функция `injectCitationLinks(text, messageId, maxN)`.
- `client/src/components/SourcesBlock.tsx` — новый компонент: вертикальный список `Card` с якорем `<a id="src-{messageId}-{position}">`, favicon через Google S2, host, title-ссылка, snippet (3 строки `-webkit-line-clamp`).
- `client/src/components/SourcesBlock.css` — минимальный CSS (нативный, mobile-first, hover-underline на ссылке).
- `client/src/components/ChatStream.tsx` — полный рефакторинг: определён тип `SourcesMessageContent`; создан `messageRendererRegistry` через `createMessageRendererRegistry` + `registerMessageRenderer`; `toAikitMessage` для assistant с sources отдаёт массив `[{ type: 'sources', ... }, { type: 'text', ... }]`; текст препроцессится через `injectCitationLinks`; стриминговое сообщение берёт `partialSources` из `streamStore`.

Подход к интеграции `SourcesBlock`:
Выбран `messageRendererRegistry` (не fallback). API оказался чистым: `createMessageRendererRegistry` + `registerMessageRenderer` экспортированы из `@gravity-ui/aikit` и совпадают с исходниками. `content` assistant-сообщения — массив `[sources-part, text-part]`; registry передаётся в `MessageList` через prop `messageRendererRegistry`. Это внутренне объединяется с дефолтным registry в `AssistantMessage`, поэтому `text` и `tool`/`thinking` типы продолжают работать без дополнительной регистрации.

Отличие от плана:
- В плане (`5.4`) порядок частей был `[text, sources]` — в реализации перевёрнут на `[sources, text]`, чтобы блок «Источники» рендерился **над** текстом ответа (как в golden path, раздел 2: «бэк отдаёт sources до старта LLM-стрима»).
- Стриминговый `id` — `-1` (числовой) вместо `'__streaming__'` из плана; `messageId` для якорей — строка `'streaming'` как в плане.

Favicon: реализован через `https://www.google.com/s2/favicons?domain=${host}` — минимум кода, без лишних fallback.

Проверка:
- `cd client && npx tsc --noEmit` — без ошибок.
- Браузер: тогл «Web» виден в композере, переключается. При отправке с включённым Web — блок «Источники» появляется сразу (до текста ответа), карточки с favicon/host/title/snippet. Маркеры `[1]`, `[2]` в тексте рендерятся как кликабельные Markdown-ссылки. После `done` блок «Источников» остаётся — sources сохранены в `chatStore.messages`. После перезагрузки страницы сообщения с источниками рендерятся идентично: `GET /messages` отдаёт `sources`, `toAikitMessage` строит массив контента.

Расхождения с планом: только порядок частей (sources выше текста). Всё остальное — по плану.

Доработки после субагента (упёрся в лимит до финальной проверки):
- В `ChatStream.tsx` была опечатка `buildRegistry(streaming)` — функция определена без параметров, `tsc` падал. Registry не зависит от пропсов/состояния, поэтому вынес `messageRendererRegistry` в модульный уровень и убрал `useMemo` + импорт `useMemo`.
- Браузерная проверка пройдена через Playwright (вместо `cd client && npm run dev` пришлось поднять сервер заново — был остановлен): тогл «Web» включается, при запросе «кто сейчас президент Франции» блок «Источники» появляется с 5 карточками (`.sources-block__card`), якоря `src-{messageId}-{1..5}` присутствуют, цитата `[1]` рендерится как ссылка на `#src-126-1`, клик прокручивает к якорю, после reload `GET /messages` возвращает sources, блок и цитаты рендерятся идентично свежему ответу.

## Этап 4 — стиль и проверка

Изменённые/созданные файлы:
- `client/src/components/SourcesBlock.css` — ревизия CSS: `gap` 8→6, `padding` 10→8 (компактнее), `word-break` → `overflow-wrap` (современный стандарт, не ломает слова посреди), mobile-first `line-clamp: 2` со снятием до 3 строк на `min-width: 640px`, убран лишний `width: 100%` у карточки. Без переусложнения, по правилу «здоровый минимализм».
- `e2e/tests/web-search.spec.ts` — smoke E2E на Playwright (golden path).

E2E (`web-search.spec.ts`) — один тест:
1. Создаём чат через API, логинимся, переходим на `/chat/:id`.
2. Включаем тогл «Web» (клик по `label.g-switch` — у `g-switch__slider` есть pointer-intercept, который не даёт кликнуть по `<input role="switch">` напрямую).
3. Перехватываем POST `/messages/stream` и проверяем `webSearch: true` в теле.
4. Задаём реальный вопрос («Кто сейчас президент Франции?»), реально дёргаем Yandex Search + LLM.
5. Ждём `.sources-block` (timeout 30s), проверяем ≥1 карточку.
6. Дожидаемся конца стриминга, ищем в `.g-aikit-assistant-message` либо ссылку `a[href^="#src-"]`, либо текстовый маркер `[N]` (на случай если LLM не поставила маркеры — это не баг).
7. Кликаем по цитате, проверяем что карточка `.sources-block__card` в viewport.
8. `finally`: `cancelStreamIfActive` + `deleteChatViaApi`.

Прогон: **1/1 passed, 5.7s**. Скриншоты: `e2e/screenshots/ws-01-sources-block.png`, `ws-02-after-streaming.png`, `ws-03-citation-clicked.png`.

Находки в процессе (не баги фичи, особенности библиотек):
- `gravity-ui Switch`: клик по `getByRole('switch')` блокируется `g-switch__slider` (pointer-events overlay). Воркэраунд — клик по `label.g-switch`.
- В исходниках `aikit` ассистент-сообщение — `.g-aikit-assistant-message` (через `block('assistant-message')`), а не `.g-aikit-message`.

## Этап 5 — спеки

Обновлены:
- `specs/overview.md` — добавлен `Source` в `shared/types.ts`, поле `Message.sources?`, вариант SSE `{ type: 'sources'; sources }`, ENV `YC_SEARCH_API_KEY`, сценарии 21–25 (Web search).
- `server/specs/backend.md` — таблица `sources` (SQL + индекс), зависимость `fast-xml-parser`, путь `services/search.ts`, поля `model`/`systemPrompt`/`webSearch` в POST body, `sources`-эвент в SSE, шаги 3a/7/9 в потоке стриминга (запрос в Yandex Search до стрима, sources первым SSE-фреймом, bulk-insert в БД).
- `client/specs/frontend.md` — `components/SourcesBlock.tsx`, `components/ChatComposer.tsx`, `utils/citations.ts`, `stores/settingsStore.ts` в структуре; тогл «Web» и `SourcesBlock` в таблице компонентов; `useSettingsStore` (model/systemPrompt/webSearch, persist `dexity-settings`); `partialSources` в `streamStore`; ветка `sources` в SSE-парсере; отдельный раздел «Web search: рендер цитат и блока Источники».

Спеки про существующие до фичи поля `model`/`systemPrompt` в POST body тоже подтянуты — они присутствовали в коде до web search, но не были отражены в backend.md. Залатано вместе.
