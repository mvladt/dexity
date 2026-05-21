# План: Web search + цитаты (фича #15 из `aikit-improvements-plan.md`)

Главная фишка Perplexity — приземлить ответы LLM на свежие веб-источники с маркерами цитат `[1]`, `[2]` и блоком «Источники» под ответом.

## 1. Решения по архитектуре (зафиксировано)

- **Поисковый провайдер:** Yandex Search API.
- **Триггер поиска:** ручной тогл в UI (кнопка «Web» рядом с селектом модели). Без поиска чат работает как сейчас.
- **Глубина контента:** только снипы из поисковой выдачи (для MVP). Углублённый режим с парсингом HTML — в `TODO.md`.
- **Рендер цитат:** маркеры `[1]` в тексте → Markdown-линки на якоря в блоке «Источники» под ответом. `InlineCitation` из aikit использовать **нельзя** — компонент в репозитории пустой (`export {}`), несмотря на упоминание в `aikit-improvements-plan.md`.

## 2. Golden path

1. Пользователь включает тогл «Web» в `ChatComposer`, пишет вопрос, жмёт send.
2. Фронт шлёт `POST /api/chats/:chatId/messages/stream` c `webSearch: true`.
3. Бэк делает запрос в Yandex Search API → топ-5 результатов (`title`, `url`, `snippet`).
4. Бэк отдаёт фронту SSE-эвент `{ type: 'sources', sources }` **до старта LLM-стрима** (чтобы UI сразу показал «Источники» с скелетоном/спиннером ответа).
5. Бэк строит системный промпт-аддон со снипами и инструкцией ставить маркеры `[1]…[5]`.
6. Бэк стримит ответ LLM через SSE как сейчас (`type: 'delta'`).
7. По завершении бэк сохраняет ответ + источники в БД, отдаёт `{ type: 'done', ... }`.
8. При перезагрузке страницы `GET /api/chats/:chatId/messages` возвращает сообщения вместе с привязанными к ним источниками — UI рендерит цитаты идентично свежим.

## 3. Edge cases

- **Поиск упал (5xx / таймаут):** не блокировать ответ. Шлём `{ type: 'sources', sources: [] }`, в системный промпт инжектим заметку «Поиск временно недоступен, отвечай по своим знаниям». Тогл остался включённым — пользователь видит пустой блок «Источники» с пояснением.
- **Поиск вернул 0 результатов:** аналогично, sources=[], в промпт — «по запросу ничего не найдено».
- **Пользователь отменил стрим (cancel):** сохранять источники не нужно — без assistant-сообщения они никому не принадлежат. Просто не пишем их в БД.
- **Yandex API нет ключа / 401:** SSE-эвент `{ type: 'error', code: 'auth', message: 'Поиск не настроен' }`, ответ LLM не запускаем (иначе непонятно, что пошло не так).
- **Модель не поставила ни одного маркера:** ничего не делаем — блок «Источники» виден, маркеров в тексте нет. Это нормально, не баг.
- **Модель сослалась на `[6]`, которого нет:** при рендере молча игнорируем (оставляем как plain text).

## 4. Бэкенд

### 4.1. ENV / зависимости

- [ ] **Новый env:** `YC_SEARCH_API_KEY` (отдельный API-ключ со scope `yc.search-api.execute`). Существующий `YC_API_KEY` используется для AI Studio (LLM) — его scope может не включать Search API, и смешивать назначения ключей нечисто. Создаём отдельный ключ на том же сервисном аккаунте (см. раздел 7, этап 0). `folderId` для поиска — тот же `YC_FOLDER_ID`.
- [x] Добавить одну зависимость на бэк: `fast-xml-parser` (~30KB, MIT, без транзитивных зависимостей). Парсить XML регэкспами — антипаттерн.

### 4.2. Сервис поиска (`server/src/services/search.ts`)

- [x] Создать модуль с одной функцией `webSearch(query: string, signal?: AbortSignal): Promise<Source[]>`.
- [x] Тип `Source`: `{ position: number; title: string; url: string; snippet: string }` (на Этапе 1 локально в `services/search.ts`, на Этапе 2 переедет в `shared/types.ts`).
- [x] Эндпоинт: `POST https://searchapi.api.cloud.yandex.net/v2/web/search` с заголовком `Authorization: Api-Key ${YC_SEARCH_API_KEY}`, `Content-Type: application/json`.
- [x] Тело запроса (JSON):
  ```json
  {
    "query": {
      "searchType": "SEARCH_TYPE_RU",
      "queryText": "<пользовательский запрос, ≤400 симв.>",
      "familyMode": "FAMILY_MODE_MODERATE",
      "fixTypoMode": "FIX_TYPO_MODE_ON"
    },
    "groupSpec": {
      "groupMode": "GROUP_MODE_FLAT",
      "groupsOnPage": 5,
      "docsInGroup": 1
    },
    "maxPassages": 3,
    "l10n": "LOCALIZATION_RU",
    "folderId": "<YC_FOLDER_ID>",
    "responseFormat": "FORMAT_XML"
  }
  ```
- [x] Ответ — JSON `{ "rawData": "<base64>" }`. Декодируем: `Buffer.from(rawData, 'base64').toString('utf-8')`. Внутри — XML формата `<yandexsearch><response><results><grouping><group><doc><url/><domain/><title/><passages><passage/></passages></doc></group></grouping></results></response></yandexsearch>`. **Важно:** `<title>` и `<passage>` содержат подсветку `<hlword>foo</hlword>` *inline* с обычным текстом (например `<title><hlword>Борщ</hlword> по рецепту</title>`). `fast-xml-parser` ломает такой mixed content — выносит `hlword` отдельным узлом и теряет порядок текста вокруг. Поэтому вырезаем теги `<hlword>`/`</hlword>` из строки XML **до парсинга**: `xml.replace(/<\/?hlword>/g, '')`. После этого парсим через `fast-xml-parser` (`new XMLParser({ ignoreAttributes: true })`), достаём массив `doc`, маппим в `Source`. Учесть, что `fast-xml-parser` по умолчанию схлопывает одиночный элемент в объект (а не массив) — использовать опцию `isArray: (name) => ['doc','passage','group'].includes(name)`.
- [x] Перед запросом обрезать `queryText` до 400 символов (лимит API).
- [x] Обработка ошибок ответа: если внутри XML есть `<error code="...">…</error>` — лог + возврат `[]`. Если HTTP не 2xx — лог + `[]`.
- [x] Таймаут 5 сек (`AbortSignal.timeout(5_000)` + merge с переданным `signal` через `AbortSignal.any`), при ошибке/таймауте/non-2xx — возвращать пустой массив. На Этапе 1 лог через `console.error` (сервис не знает про fastify); на Этапе 2 в роуте можно прокинуть `fastify.log`.
- [x] Возвращать максимум **5** результатов (`groupSpec.groupsOnPage = 5`). Снипы (passages) склеиваем через ` `, нормализуем пробелы, тримим до 400 символов.
- [x] Никакого кэша на первой итерации.

### 4.3. БД: новая таблица `sources`

- [x] В `server/src/db/schema.ts` добавить:
  ```ts
  export const sources = sqliteTable(
    'sources',
    {
      id: integer('id').primaryKey({ autoIncrement: true }),
      messageId: integer('message_id')
        .notNull()
        .references(() => messages.id, { onDelete: 'cascade' }),
      position: integer('position').notNull(), // 1..N — соответствует [1], [2] в тексте
      title: text('title').notNull(),
      url: text('url').notNull(),
      snippet: text('snippet').notNull(),
    },
    (t) => ({
      messageIdx: index('idx_sources_message_id').on(t.messageId),
    }),
  );
  ```
- [x] В `server/src/db/migrate.ts` добавить `CREATE TABLE IF NOT EXISTS sources (…); CREATE INDEX IF NOT EXISTS …;` (без drizzle-kit — как принято в проекте).
- [x] **Не** добавлять `web_search_enabled` в `messages` — наличие записей в `sources` для данного `message_id` уже сигнал.

### 4.4. Изменения в `server/src/routes/messages.ts`

- [x] В `streamBodySchema` добавить `webSearch: z.boolean().optional()`.
- [x] Расширить тип SSE-эвентов в `shared/types.ts`: добавить вариант `{ type: 'sources'; sources: Source[] }`.
- [x] Перед открытием SSE-стрима: если `webSearch === true`, вызвать `search.webSearch(userContent, abort.signal)`. Открытие SSE оставить на месте — но первый `writeSSE` после `writeHead` сделать как раз `{ type: 'sources', sources }`.
- [x] Если sources не пустые — построить prefix к системному промпту:
  ```
  Используй источники ниже для ответа. Ставь маркеры цитат [1], [2]… сразу после факта.
  Не выдумывай факты, которых нет в источниках. Если данных недостаточно — скажи об этом.

  Источники:
  [1] {title} ({url})
  {snippet}

  [2] …
  ```
  Конкатенировать с user-systemPrompt (если есть): сначала systemPrompt, потом блок поиска.
- [x] Если sources пустые (поиск упал/нет результатов) и `webSearch === true` — добавить заметку «Поиск не дал результатов, отвечай по своим знаниям».
- [x] После получения `assistantMsg.id` — bulk-insert sources с этим `messageId`:
  ```ts
  if (sources.length > 0) {
    await db.insert(schema.sources).values(
      sources.map((s) => ({ messageId: assistantMsg.id, ...s })),
    );
  }
  ```
- [x] В `GET /api/chats/:chatId/messages`: подтягивать источники одним запросом и группировать в `Message.sources?: Source[]`. Простой путь — `db.select().from(sources).where(inArray(sources.messageId, ids))`, потом группировка в JS.

### 4.5. Расширение `Message` в `shared/types.ts`

- [x] Добавить:
  ```ts
  export interface Source {
    position: number;
    title: string;
    url: string;
    snippet: string;
  }
  export interface Message {
    // …существующие поля
    sources?: Source[];
  }
  ```

## 5. Фронт

### 5.1. Тогл «Web» в `ChatComposer`

- [x] В `client/src/stores/settingsStore.ts` добавить `webSearch: boolean` + `setWebSearch` (persist в `dexity-settings`). Тогл — глобальный, как `model`/`systemPrompt`. Это удобнее, чем per-chat: если включил — пишет всем чатам с поиском.
- [x] В `ChatComposer.tsx` в `bottomContent` рядом с `Select` модели добавить тогл `Switch` из `@gravity-ui/uikit` с лейблом «Web». Без поиска иконок/кастомных компонентов.

### 5.2. SSE-обработка

- [x] В `client/src/services/stream.ts` добавить колбэк `onSources(sources: Source[])` в `StreamCallbacks` и ветку `event.type === ‘sources’`.
- [x] В `client/src/stores/streamStore.ts`:
  - Добавить `partialSources: Source[]` (накапливается во время стрима).
  - Прокинуть `webSearch` из `settingsStore` в `streamMessages`.
  - В `onSources` — `set({ partialSources: sources })`.
  - В `onDone` — при `appendMessage` подложить `sources: partialSources`, сбросить `partialSources: []`.

### 5.3. Передача `webSearch` в запрос

- [x] В `streamMessages` принимать `webSearch?: boolean` и добавлять в body.

### 5.4. Рендер цитат и блока «Источники»

**Подход:** препроцессим текст сообщения перед передачей в `MarkdownRenderer` — заменяем `[N]` на Markdown-линки `[\[N\]](#src-msgId-N)`. Сам блок «Источники» рендерим под текстом, у каждого источника — `<a id="src-msgId-N">`. Якоря работают в SPA без роутинга, потому что прыжок внутри страницы.

- [x] Решение: **использовать `messageRendererRegistry`**. `content` — массив двух частей: сначала `{ type: ‘sources’, data: { sources, messageId } }` (рендерится как `SourcesBlock` сверху), потом `{ type: ‘text’, data: { text: preprocessed } }`. Registry зарегистрирован в `ChatStream` через `createMessageRendererRegistry` + `registerMessageRenderer` и передан в `MessageList` через `messageRendererRegistry`.
- [x] Зарегистрировать кастомный тип контента `sources` через `createMessageRendererRegistry` + `registerMessageRenderer` и передать registry в `MessageList` через prop `messageRendererRegistry`.
- [x] Компонент `<SourcesBlock messageId={...} sources={[...]} />`: вертикальный список карточек (Card из `@gravity-ui/uikit`), у каждой — `<a id="src-{messageId}-{position}">`, title (ссылка, target="_blank"), под title — host + favicon, snippet.
- [x] Препроцесс текста — отдельная утилка `client/src/utils/citations.ts`.
- [x] Для **стриминга**: источники рендерятся сразу из `partialSources`, маркеры препроцессятся на лету. `messageId` = `’streaming’`.

### 5.5. Загрузка источников при открытии чата

- [x] `GET /api/chats/:id/messages` не менялся — `Message.sources` подтягивается автоматически.
- [x] В `toAikitMessage` (в `ChatStream.tsx`) `sources` из `msg.sources` подкладываются в контент для assistant-сообщений.

## 6. Обновить спеки

- [ ] `specs/overview.md` — добавить web-search в список пользовательских сценариев, описать тип `Source`.
- [ ] `server/specs/backend.md` — таблица `sources`, новый эвент `sources` в SSE-стриме, новое поле `webSearch` в body, ENV для Yandex Search.
- [ ] `client/specs/frontend.md` — тогл «Web» в композере, кастомный renderer для блока «Источники», препроцесс цитат, поле `webSearch` в `settingsStore`.

## 7. Пошаговый чек-лист

### Этап 0 — доступ к Yandex Search API v2 (делает пользователь вручную через `yc`)

> Старый v1-эндпоинт `yandex.com/search/xml` **выключен** (ошибка `4002: XML-search queries with the old version (v1) are forbidden`). Используем **Search API v2**: REST-эндпоинт `https://searchapi.api.cloud.yandex.net/v2/web/search`.

- [x] (выбран) SA для Search API — `ajepn79g4psakc0u6f2a` (`ai-studio-e5b0ee`), тот же, что держит текущий `YC_API_KEY`.
- [x] **Удалить ошибочно выданную роль `search-api.executor`** (она для устаревшего v1 API): `yc resource-manager folder remove-access-binding $YC_FOLDER_ID --role search-api.executor --subject serviceAccount:ajepn79g4psakc0u6f2a`.
- [x] **Выдать актуальную роль `search-api.webSearch.user`**: `yc resource-manager folder add-access-binding $YC_FOLDER_ID --role search-api.webSearch.user --subject serviceAccount:ajepn79g4psakc0u6f2a`.
- [x] **Создать отдельный API-ключ со scope `yc.search-api.execute`** (секрет показывается только при создании — записать сразу): `yc iam api-key create --service-account-id ajepn79g4psakc0u6f2a --scopes yc.search-api.execute --format json`. → ключ id `aje64vb6rbt3o4100tt8`.
- [x] Добавить полученный секрет в `server/.env` как `YC_SEARCH_API_KEY=...`.
- [x] Проверить curl'ом (подставить `$YC_FOLDER_ID` и `$YC_SEARCH_API_KEY`):
  ```bash
  curl -sS -X POST "https://searchapi.api.cloud.yandex.net/v2/web/search" \
    -H "Authorization: Api-Key $YC_SEARCH_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"query\":{\"searchType\":\"SEARCH_TYPE_RU\",\"queryText\":\"test\"},\"groupSpec\":{\"groupMode\":\"GROUP_MODE_FLAT\",\"groupsOnPage\":3,\"docsInGroup\":1},\"folderId\":\"$YC_FOLDER_ID\",\"responseFormat\":\"FORMAT_XML\"}" \
    | jq -r '.rawData' | base64 -d | head -c 800
  ```
  Должен прийти XML с `<yandexsearch><response>…<results>…</results>…</response>`. Если `<error code="...">` — читать `code`/текст (часто проблема в scope/роли, IAM может реплицироваться до 60 сек).

### Этап 1 — поиск работает изолированно
- [x] `cd server && npm install fast-xml-parser`.
- [x] Реализовать `services/search.ts` + ручной тест: `cd server && npx tsx --env-file=.env -e "import('./src/services/search.ts').then(m => m.webSearch('как сварить борщ').then(r => console.log(JSON.stringify(r, null, 2))))"` → вернул 5 источников с непустыми title/url, у трёх — непустой snippet.

### Этап 2 — бэк отдаёт sources в стрим
- [x] Миграция таблицы `sources`.
- [x] Расширить `shared/types.ts` (Source, SSEEvent).
- [x] Изменить роут `messages/stream`: тогл, инжект в промпт, sources-эвент, сохранение в БД.
- [x] Расширить `GET /messages` — отдавать source’ы.
- [x] Проверить через `curl` SSE-выхлоп с `webSearch: true`.

### Этап 3 — фронт показывает блок «Источники»
- [x] Тогл «Web» в `settingsStore` + `ChatComposer`.
- [x] `webSearch` в `streamMessages` body.
- [x] SSE-эвент `sources` → `streamStore.partialSources`.
- [x] Кастомный renderer `sources` через registry, компонент `SourcesBlock`.
- [x] Препроцесс цитат `[N]` → Markdown-линки c якорями.
- [x] Поле `sources` в `chatStore.messages` (тип уже расширен).

### Этап 4 — стиль и проверка
- [x] CSS для `SourcesBlock`: компактный список карточек, hover на ссылках, mobile-first.
- [ ] Smoke E2E (Playwright): включить тогл, задать вопрос, дождаться `sources`-блока, кликнуть `[1]` → проверить scroll к якорю.

## 8. Риски и открытые вопросы

- **InlineCitation в aikit пустой** — нельзя на него рассчитывать. Решено: своя реализация через Markdown-линки + якоря.
- **Платность Yandex Search API v2.** Тариф уточнить (в MCP-ответе не нашлось точного прайса). Квоты по умолчанию: 10 RPS / 10 000 запросов в час sync — для личного проекта более чем достаточно.
- **Лицензионные ограничения** Yandex Search для коммерческого использования. Для личного проекта (как заявлено в CLAUDE.md) — должно быть ОК.
- **Markdown vs кастомный renderer для блока источников.** Если регистрация кастомного типа контента в `MessageList` окажется тяжёлой/неустойчивой (надо смотреть точный API в `MessageList.tsx`) — fallback: рендерить блок источников **рядом** с `MessageList`, через `messageExtraInfo` или просто следующим элементом в DOM, не залезая в registry.
- **Стриминг + якоря.** Во время стрима `messageId` фиктивный (`streaming`); после `done` — настоящий. Якоря не должны ломаться. Проверить, что замена не вызывает мерцания (re-render Markdown’а на каждом delta — потенциальная проблема производительности; aikit уже обрабатывает «инкрементальный markdown», должно ОК).
