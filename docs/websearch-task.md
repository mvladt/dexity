# Минималистичный Web Search через нативный aikit `ToolMessage`

Связанное: `docs/thinking-task.md` (та же архитектура SSE), `archive/web-search` (откуда переиспользуем поисковый код).
Источник дизайна: `dexity-gravity-ui/project/chat.jsx` (артборд **«02 · Стриминг: Thinking + Web Search»**) — простой `ToolMessage` с лейблом «Web Search», в `bodyContent` — список доменов с favicon.

## Ключевая идея

Web Search — это **один вызов tool**, ничего больше. Никакой своей таблицы `sources`, никаких inline-цитат `[1]` с якорями, никакого кастомного `SourcesBlock`. Используем нативный компонент `ToolMessage` из `@gravity-ui/aikit`, который уже умеет всё: collapse/expand, статусы (`loading`/`success`/`error`), `headerContent`, `bodyContent`.

В БД sources хранятся в **одном поле `tool_data` рядом с `thinking`** — без отдельной таблицы.

## Что меняется по сравнению со старой реализацией (`archive/web-search`)

| Аспект                  | Было                                          | Станет                                                          |
|-------------------------|-----------------------------------------------|-----------------------------------------------------------------|
| БД                      | Отдельная таблица `sources` (cascade на messages) | Колонка `tool_data TEXT` (JSON `Source[]`) в `messages`         |
| SSE                     | `{type:'sources', sources: Source[]}`         | `{type:'tool', tool: {name, status, sources}}` (один-два эвента)|
| Inline-цитаты `[1]`     | `injectCitationLinks` + якоря `#src-{id}-{n}` | **Не делаем.** Модели даём контекст, расставление маркеров — на её усмотрение |
| Промпт-блок для LLM     | «Используй источники [N] {title}…»            | Сохраняем — это полезно, мало кода                              |
| Фронт-компонент         | Кастомный `SourcesBlock` (карточки, favicon, snippet, hover) | Нативный `ToolMessage` из aikit + минимальный inline `bodyContent` |
| `messageRendererRegistry` | Кастомный `sources`-part                      | Не нужен — `tool`-part уже в default-registry aikit             |

**Минус ~250 строк кода** (свой SourcesBlock + citations.ts + расширенные SSE-эвенты + миграции таблицы).

## Что в aikit нативно

`ToolMessage` (organism) — карточка с `padding: 8px`, `border-radius: 14px`. Поля:

- `toolName: string` — «Web Search»
- `toolIcon: ReactNode` — иконка-глобус из `@gravity-ui/icons`
- `headerContent: ReactNode` — «Yandex Search · 5 источников» / «… в работе»
- `status: 'loading' | 'success' | 'error'`
- `bodyContent: ReactNode` — раскрываемое тело (список доменов)
- `autoCollapseOnSuccess: true` — после `success` свернётся сам

В `defaultMessageRegistry` уже зарегистрирован `{type:'tool', data: ToolMessageProps}` — рисуется автоматически в `MessageList`.

## Поток данных

```
1. Пользователь → POST /stream { content, webSearch: true }
2. Бэк: webSearch(content) → Source[]  (синхронно, перед стримом LLM)
3. Бэк: SSE {type:'tool', tool: {name:'web', status:'success', sources}}  ──►  фронт рендерит ToolMessage в стриминговом сообщении
4. Бэк: LLM-стрим с обогащённым промптом ──►  обычные delta-эвенты
5. Бэк: insert message { content, thinking, tool_data: JSON(sources) }
6. Бэк: SSE {type:'done', ..., fullTool: {...}}  ──►  фронт сохраняет в Message.tool_data
```

Если `webSearch === false` → ничего не делаем, всё как сейчас.

Если поиск упал / нет результатов → `{type:'tool', tool:{name:'web', status:'error'}}` или `status:'success'` с пустым массивом. **Тогда** LLM получает примечание в промпте «Поиск не дал результатов».

## Что меняется

### 1. БД — миграция

`messages.tool_data TEXT NULL` (JSON-сериализованный объект `{ sources: Source[] }`).
Идемпотентный ALTER через `PRAGMA table_info` (как для `thinking`).

### 2. `shared/types.ts`

```ts
export interface Source {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface MessageToolData {
  sources?: Source[];     // нет источников = нет tool-part
}

export interface Message {
  ...
  toolData?: MessageToolData | null;  // ← новое
}

export type SSEEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'delta'; delta: string }
  | { type: 'tool'; tool: { name: 'web'; status: 'loading' | 'success' | 'error'; sources?: Source[] } }
  | { type: 'done'; fullContent: string; fullThinking?: string; fullTool?: MessageToolData; assistantMessageId: number; chatTitle?: string }
  | { type: 'error'; code: 'auth' | 'quota' | 'server'; message: string };
```

### 3. Бэк

- `server/src/services/search.ts` — **копируем 1:1** из `archive/web-search` (`fast-xml-parser`, `webSearch(query, signal)`). +зависимость `fast-xml-parser` в `server/package.json`.
- `.env` — `YC_SEARCH_API_KEY` (взять из старой ветки).
- `routes/messages.ts`:
  - `streamBodySchema` ← `webSearch: z.boolean().optional()`
  - До открытия SSE: если `webSearch === true` → `webSearch(content, abort.signal)` → `Source[]`
  - Шлём `{type:'tool', tool:{...}}` (один раз, перед LLM)
  - Промпт-блок: если sources непустые — «Используй источники: [1] {title}({url})…», иначе note «Поиск не дал результатов»
  - При insert assistant → `toolData: sources.length > 0 ? { sources } : null`
  - В `done` → `fullTool: { sources }` (если есть)

### 4. Фронт

- `streamStore`:
  - `partialTool: MessageToolData | null`
  - `onTool(tool)` → `set({ partialTool: { sources: tool.sources } })`
  - `cancel/start/done` → сброс
  - `onDone(..., fullTool)` → `appendMessage({ ..., toolData: fullTool })`
- `ChatStream.tsx → toAikitMessage`:
  - Если у assistant `toolData.sources` есть → парт `{type:'tool', data: { toolName:'Web Search', toolIcon:<IconGlobe/>, status:'success', headerContent:`${sources.length} источников`, bodyContent: <SourcesList sources={...}/> }}` **перед** текстом
  - Если есть `thinking` → парт `thinking` идёт **первым**, потом `tool`, потом `text`
- `ChatComposer.tsx` — добавить `<Switch>Web</Switch>` (1:1 из старой ветки)
- `settingsStore.webSearch: boolean` — персистент
- `SourcesList` — крошечный компонент: `<ul>` со ссылками (`favicon из google s2 + host + title`). ~40 строк inline в `ChatStream.tsx`, без отдельного файла.

## Что НЕ делаем

- Inline-цитаты `[1]`, `[2]` — модель пусть пишет их в тексте сама, мы их не превращаем в кликабельные ссылки. Если очень захочется — отдельная фича потом.
- `Pro Search` / выбор «Off / Web / Pro» — только обычный тогл Web как сейчас.
- Кастомные карточки с snippet'ами — `bodyContent` минималистичный список.
- Отдельную таблицу `sources` с position/cascade.
- Кэширование результатов поиска (тот же запрос = новый запрос к Yandex).

## Открытые вопросы

1. **Snippet'ы показывать?** В дизайне они есть в `bodyContent`, но крошечные («Загружаю топ-5 снипов…»). Можно хранить и не показывать — это +память в БД. **Рекомендация:** хранить, но в `bodyContent` показывать только host + title (без snippet) — клик ведёт на оригинал.
2. **Промежуточный `status:'loading'`-эвент?** Старый поток шлёт sources одним блобом. Можно шлять `{tool:{status:'loading'}}` сразу при начале поиска и потом `{status:'success', sources}` — UX «думает» лучше. **Рекомендация:** да, два эвента.
3. **Какой статус показать, если поиск упал?** `status:'error'` (красный) или `status:'success'` с пустыми sources (серый «не найдено»)? **Рекомендация:** `error` — лучше честно сказать «поиск не сработал», чем «пусто».
4. **Хранить `tool_data` или нет?** По аналогии с thinking — храним. После reload истории блок «Web Search · 5 источников» остаётся свёрнутым. Минимум кода.

## План

- [ ] 1. Скопировать `services/search.ts` из `archive/web-search` + добавить `fast-xml-parser` в `server/package.json` + `YC_SEARCH_API_KEY` в `.env.example`
- [ ] 2. Миграция БД — колонка `tool_data TEXT` в `messages` (ALTER через PRAGMA, как для thinking)
- [ ] 3. `shared/types.ts` — `Source`, `MessageToolData`, расширить `SSEEvent` тип `'tool'`, поле `Message.toolData`
- [ ] 4. Бэк — `streamBodySchema.webSearch`, вызов `webSearch()` до LLM, два SSE-эвента (`loading` → `success`/`error`), промпт-блок, insert+done
- [ ] 5. Фронт-store — `settingsStore.webSearch` + `streamStore.partialTool` + callback `onTool`
- [ ] 6. Фронт `stream.ts` — обработка `{type:'tool'}` эвента, передача `webSearch` в body POST
- [ ] 7. Фронт `ChatComposer` — `<Switch>Web</Switch>` рядом с моделью
- [ ] 8. Фронт `ChatStream.toAikitMessage` — порядок партов `[thinking?, tool?, text]`; inline `<SourcesList>` рендерер для `bodyContent`
- [ ] 9. Тест вживую: тогл Web включён → запрос «кто сейчас президент Франции» → `ToolMessage` загорелся loading → success с 5 ссылками → текст ответа от модели; reload → блок остался свёрнутым; тогл выключен → блок не появляется
- [ ] 10. Коммит

## Готов согласовать?

Если ок — иду по чекбоксам по порядку, проверяю тайпчеком на каждом шаге, в конце прошу проверить вживую и коммичу.
