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

- [ ] **Новых env-переменных не нужно.** Переиспользуем существующий `YC_API_KEY` — достаточно вне кода добавить роль `search-api.executor` к тому же сервисному аккаунту (см. раздел 7, этап 0). `folderid` для поиска — тот же `YC_FOLDER_ID`.
- [ ] Добавить одну зависимость на бэк: `fast-xml-parser` (~30KB, MIT, без транзитивных зависимостей). Парсить XML регэкспами — антипаттерн.

### 4.2. Сервис поиска (`server/src/services/search.ts`)

- [ ] Создать модуль с одной функцией `webSearch(query: string, signal?: AbortSignal): Promise<Source[]>`.
- [ ] Тип `Source`: `{ position: number; title: string; url: string; snippet: string }`.
- [ ] Эндпоинт: `GET https://yandex.com/search/xml?folderid=${YC_FOLDER_ID}&query=${encodeURIComponent(query)}` с заголовком `Authorization: Api-Key ${YC_API_KEY}`.
- [ ] Ответ — XML. Структура (упрощённо): `<yandexsearch><response><results><grouping><group><doc><url/><title/><passages><passage/></passages></doc></group></grouping></results></response></yandexsearch>`. Парсим через `fast-xml-parser` (`new XMLParser({ ignoreAttributes: true })`), достаём массив `doc`, маппим в `Source`. `title` и `passage` могут содержать `<hlword>foo</hlword>` — выкусываем теги простым `.replace(/<\/?hlword>/g, '')`.
- [ ] Таймаут 5 сек (`AbortSignal.timeout(5_000)` + merge с переданным `signal`), при ошибке/таймауте/non-2xx — возвращать пустой массив + лог через `fastify.log` (логирование вынести в роут — сервис не знает про fastify).
- [ ] Возвращать максимум **5** результатов (`groups-on-page=5` в query-параметрах). Снипы (passages) склеиваем через ` `, тримим до 400 символов.
- [ ] Никакого кэша на первой итерации.

### 4.3. БД: новая таблица `sources`

- [ ] В `server/src/db/schema.ts` добавить:
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
- [ ] В `server/src/db/migrate.ts` добавить `CREATE TABLE IF NOT EXISTS sources (…); CREATE INDEX IF NOT EXISTS …;` (без drizzle-kit — как принято в проекте).
- [ ] **Не** добавлять `web_search_enabled` в `messages` — наличие записей в `sources` для данного `message_id` уже сигнал.

### 4.4. Изменения в `server/src/routes/messages.ts`

- [ ] В `streamBodySchema` добавить `webSearch: z.boolean().optional()`.
- [ ] Расширить тип SSE-эвентов в `shared/types.ts`: добавить вариант `{ type: 'sources'; sources: Source[] }`.
- [ ] Перед открытием SSE-стрима: если `webSearch === true`, вызвать `search.webSearch(userContent, abort.signal)`. Открытие SSE оставить на месте — но первый `writeSSE` после `writeHead` сделать как раз `{ type: 'sources', sources }`.
- [ ] Если sources не пустые — построить prefix к системному промпту:
  ```
  Используй источники ниже для ответа. Ставь маркеры цитат [1], [2]… сразу после факта.
  Не выдумывай факты, которых нет в источниках. Если данных недостаточно — скажи об этом.

  Источники:
  [1] {title} ({url})
  {snippet}

  [2] …
  ```
  Конкатенировать с user-systemPrompt (если есть): сначала systemPrompt, потом блок поиска.
- [ ] Если sources пустые (поиск упал/нет результатов) и `webSearch === true` — добавить заметку «Поиск не дал результатов, отвечай по своим знаниям».
- [ ] После получения `assistantMsg.id` — bulk-insert sources с этим `messageId`:
  ```ts
  if (sources.length > 0) {
    await db.insert(schema.sources).values(
      sources.map((s) => ({ messageId: assistantMsg.id, ...s })),
    );
  }
  ```
- [ ] В `GET /api/chats/:chatId/messages`: подтягивать источники одним запросом и группировать в `Message.sources?: Source[]`. Простой путь — `db.select().from(sources).where(inArray(sources.messageId, ids))`, потом группировка в JS.

### 4.5. Расширение `Message` в `shared/types.ts`

- [ ] Добавить:
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

- [ ] В `client/src/stores/settingsStore.ts` добавить `webSearch: boolean` + `setWebSearch` (persist в `dexity-settings`). Тогл — глобальный, как `model`/`systemPrompt`. Это удобнее, чем per-chat: если включил — пишет всем чатам с поиском.
- [ ] В `ChatComposer.tsx` в `bottomContent` рядом с `Select` модели добавить тогл `Switch` из `@gravity-ui/uikit` с лейблом «Web». Без поиска иконок/кастомных компонентов.

### 5.2. SSE-обработка

- [ ] В `client/src/services/stream.ts` добавить колбэк `onSources(sources: Source[])` в `StreamCallbacks` и ветку `event.type === 'sources'`.
- [ ] В `client/src/stores/streamStore.ts`:
  - Добавить `partialSources: Source[]` (накапливается во время стрима).
  - Прокинуть `webSearch` из `settingsStore` в `streamMessages`.
  - В `onSources` — `set({ partialSources: sources })`.
  - В `onDone` — при `appendMessage` подложить `sources: partialSources`, сбросить `partialSources: []`.

### 5.3. Передача `webSearch` в запрос

- [ ] В `streamMessages` принимать `webSearch?: boolean` и добавлять в body.

### 5.4. Рендер цитат и блока «Источники»

**Подход:** препроцессим текст сообщения перед передачей в `MarkdownRenderer` — заменяем `[N]` на Markdown-линки `[\[N\]](#src-msgId-N)`. Сам блок «Источники» рендерим под текстом, у каждого источника — `<a id="src-msgId-N">`. Якоря работают в SPA без роутинга, потому что прыжок внутри страницы.

- [ ] Решение: **не использовать `messageRendererRegistry`**. У нас одно текстовое сообщение с трейлером — проще обернуть `MessageList` через `assistantMessageProps`/кастомный renderer или передавать `content` как массив частей. Но `MessageList` из aikit принимает массив `TChatMessage`, поле `content` — строка либо массив `TMessageContent`. Используем массив:
  ```ts
  content: [
    { type: 'text', data: { text: preprocessed } },
    { type: 'sources', data: { sources, messageId } }, // custom
  ]
  ```
- [ ] Зарегистрировать кастомный тип контента `sources` через `createMessageRendererRegistry` + `registerMessageRenderer` (см. `messageTypeRegistry.ts` в aikit) и передать registry в `MessageList` через prop `messageRendererRegistry` (проверить точное имя prop’а в `MessageList.tsx`).
- [ ] Компонент `<SourcesBlock messageId={...} sources={[...]} />`: вертикальный список карточек (Card из `@gravity-ui/uikit`), у каждой — `<a id="src-{messageId}-{position}">`, title (ссылка, target="_blank"), под title — host (favicon опционально, через `https://www.google.com/s2/favicons?domain=…`), snippet.
- [ ] Препроцесс текста — отдельная утилка `client/src/utils/citations.ts`:
  ```ts
  export function injectCitationLinks(text: string, messageId: string, maxN: number): string {
    return text.replace(/\[(\d+)\]/g, (m, n) =>
      Number(n) >= 1 && Number(n) <= maxN ? `[\\[${n}\\]](#src-${messageId}-${n})` : m,
    );
  }
  ```
- [ ] Для **стриминга** (когда `message.id === '__streaming__'` и текст ещё догоняет): рендерить источники сразу из `partialSources` (они уже пришли до первого delta), маркеры в тексте — препроцессить на лету. `messageId` для якорей — фиксированная строка `streaming`.

### 5.5. Загрузка источников при открытии чата

- [ ] `client/src/services/chats.ts` или где сейчас `GET /api/chats/:id/messages` — ничего не менять, тип `Message.sources` подхватится автоматом (бэк начнёт его отдавать).
- [ ] `chatStore.messages` — проверить, что Message с sources прокидывается в `toAikitMessage` → в `content` подкладываются обе части (`text` + `sources`). Если у сообщения `sources` нет — отдаём `content: string` как сейчас.

## 6. Обновить спеки

- [ ] `specs/overview.md` — добавить web-search в список пользовательских сценариев, описать тип `Source`.
- [ ] `server/specs/backend.md` — таблица `sources`, новый эвент `sources` в SSE-стриме, новое поле `webSearch` в body, ENV для Yandex Search.
- [ ] `client/specs/frontend.md` — тогл «Web» в композере, кастомный renderer для блока «Источники», препроцесс цитат, поле `webSearch` в `settingsStore`.

## 7. Пошаговый чек-лист

### Этап 0 — доступ к Yandex Search API (делает пользователь вручную через `yc`)
- [ ] Найти SA, на котором висит существующий `YC_API_KEY`: `yc iam api-key list --format json | jq '.[] | {id, service_account_id, created_at}'` → опознать по дате создания.
- [ ] Добавить SA роль `search-api.executor`: `yc resource-manager folder add-access-binding $YC_FOLDER_ID --role search-api.executor --subject serviceAccount:<SA_ID>`.
- [ ] Проверить curl'ом: `curl -sS "https://yandex.com/search/xml?folderid=$YC_FOLDER_ID&query=test" -H "Authorization: Api-Key $YC_API_KEY" | head -c 500` — должен прийти XML с `<response>`. Если пришёл `<error>` с описанием прав — роль не приклеилась (репликация IAM до 30 сек, подождать).

### Этап 1 — поиск работает изолированно
- [ ] `cd server && npm install fast-xml-parser`.
- [ ] Реализовать `services/search.ts` + ручной тест: `cd server && npx tsx -e "import('./src/services/search.ts').then(m => m.webSearch('как сварить борщ').then(r => console.log(JSON.stringify(r, null, 2))))"`.

### Этап 2 — бэк отдаёт sources в стрим
- [ ] Миграция таблицы `sources`.
- [ ] Расширить `shared/types.ts` (Source, SSEEvent).
- [ ] Изменить роут `messages/stream`: тогл, инжект в промпт, sources-эвент, сохранение в БД.
- [ ] Расширить `GET /messages` — отдавать source’ы.
- [ ] Проверить через `curl` SSE-выхлоп с `webSearch: true`.

### Этап 3 — фронт показывает блок «Источники»
- [ ] Тогл «Web» в `settingsStore` + `ChatComposer`.
- [ ] `webSearch` в `streamMessages` body.
- [ ] SSE-эвент `sources` → `streamStore.partialSources`.
- [ ] Кастомный renderer `sources` через registry, компонент `SourcesBlock`.
- [ ] Препроцесс цитат `[N]` → Markdown-линки c якорями.
- [ ] Поле `sources` в `chatStore.messages` (тип уже расширен).

### Этап 4 — стиль и проверка
- [ ] CSS для `SourcesBlock`: компактный список карточек, hover на ссылках, mobile-first.
- [ ] Smoke E2E (Playwright): включить тогл, задать вопрос, дождаться `sources`-блока, кликнуть `[1]` → проверить scroll к якорю.

## 8. Риски и открытые вопросы

- **InlineCitation в aikit пустой** — нельзя на него рассчитывать. Решено: своя реализация через Markdown-линки + якоря.
- **Платность Yandex Search.** Тариф уточнить. Возможно, имеет смысл ограничить триггер дополнительным гейтом (например, только для определённого пользователя), но в MVP не критично.
- **Лицензионные ограничения** Yandex Search для коммерческого использования. Для личного проекта (как заявлено в CLAUDE.md) — должно быть ОК.
- **Markdown vs кастомный renderer для блока источников.** Если регистрация кастомного типа контента в `MessageList` окажется тяжёлой/неустойчивой (надо смотреть точный API в `MessageList.tsx`) — fallback: рендерить блок источников **рядом** с `MessageList`, через `messageExtraInfo` или просто следующим элементом в DOM, не залезая в registry.
- **Стриминг + якоря.** Во время стрима `messageId` фиктивный (`streaming`); после `done` — настоящий. Якоря не должны ломаться. Проверить, что замена не вызывает мерцания (re-render Markdown’а на каждом delta — потенциальная проблема производительности; aikit уже обрабатывает «инкрементальный markdown», должно ОК).
