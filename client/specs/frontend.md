# Frontend — спецификация

---

## Структура клиента (`client/`)

> **Без FSD.** Плоская структура, минимум вложенности — это пет-проект на ~6 экранов.

```
client/
├── public/
├── src/
│   ├── main.tsx                  # bootstrap
│   ├── App.tsx                   # ThemeProvider + Router + Guard
│   ├── pages/
│   │   ├── LoginPage.tsx         # вход по токену
│   │   └── ChatPage.tsx          # сайдбар + чат + EmptyContainer
│   ├── components/
│   │   ├── ChatSidebar.tsx       # обёртка над AIKit History
│   │   ├── ChatStream.tsx        # MessageList + ThinkingMessage; регистрирует messageRendererRegistry для 'sources'
│   │   ├── ChatComposer.tsx      # PromptInput + Select (модель) + Switch «Web»
│   │   ├── SourcesBlock.tsx      # блок «Источники» с карточками + якоря
│   │   └── ThemeSwitcher.tsx     # переключатель темы
│   ├── utils/
│   │   └── citations.ts          # injectCitationLinks: [N] → [\[N\]](#src-{msgId}-{N})
│   ├── stores/
│   │   ├── authStore.ts          # Zustand: token (persist localStorage)
│   │   ├── chatStore.ts          # Zustand: chats, activeChat, messages
│   │   ├── streamStore.ts        # Zustand: streaming, partialContent, partialSources
│   │   ├── settingsStore.ts      # Zustand: model, systemPrompt, webSearch (persist 'dexity-settings')
│   │   └── themeStore.ts         # Zustand: theme (persist localStorage)
│   ├── services/
│   │   ├── api.ts                # fetch-обёртка (VITE_API_URL + Bearer)
│   │   └── stream.ts             # SSE-парсер через ReadableStream; колбэки onDelta/onSources/onDone/onError
│   ├── types.ts                  # re-export из shared/types.ts
│   └── styles.css                # минимум глобальных стилей
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

**Зависимости (`client/package.json`):**

```json
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "react-router-dom": "^6",
    "zustand": "^5",
    "@gravity-ui/uikit": "^7",
    "@gravity-ui/aikit": "~1.17"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5",
    "vite": "^6"
  }
}
```

---

## Компоненты и маппинг AIKit

> Версия `@gravity-ui/aikit ~1.17` — все компоненты ниже **проверены в исходниках пакета** (`build/esm/components/` после `npm i`). Используется `~` (patch-диапазон) — миноры могут изменить API компонентов.

| Блок                            | Компонент (импорт)                           | Поведение                                                   |
| ------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Провайдер темы                  | `ThemeProvider` (`@gravity-ui/uikit`)        | `theme` из `themeStore` (`light` / `dark` / `system`)       |
| Переключатель темы              | `Switch` (`@gravity-ui/uikit`)               | Меняет `theme` в `themeStore`                               |
| Корневой лейаут чата            | `ChatContainer` (`@gravity-ui/aikit`)        | Композит: header + content + input                          |
| Список сообщений                | `MessageList` (`@gravity-ui/aikit`)          | Принимает массив сообщений                                  |
| Сообщение ассистента            | `AssistantMessage` (`@gravity-ui/aikit`)     | Внутри — `MarkdownRenderer`. `isThinking` во время стрима   |
| Сообщение пользователя          | `UserMessage` (`@gravity-ui/aikit`)          | Plain text                                                  |
| Поле ввода                      | `PromptInput` (`@gravity-ui/aikit`)          | `onSubmit`, `disabled` во время стрима                      |
| Тогл web search                 | `Switch` (`@gravity-ui/uikit`)               | Лейбл «Web» рядом с `Select` модели; биндится на `settingsStore.webSearch` |
| Блок «Источники»                | `SourcesBlock` (кастомный)                   | Регистрируется через `messageRendererRegistry` как content-type `sources`; рендерит карточки (Card uikit) с якорями `<a id="src-{messageId}-{position}">` |
| Сайдбар (история чатов)         | `History` (`@gravity-ui/aikit`)              | `items[]`, действия `onSelect`/`onRename`/`onDelete`        |
| Пустое состояние                | `EmptyContainer` (`@gravity-ui/aikit`)       | Показывается на `/chat` без активного чата                  |
| Подсказки на пустом экране      | `Suggestions` (`@gravity-ui/aikit`)          | Perplexity-стайл квик-старт промпты (3-4 шт. захардкожены) |
| Стриминг / thinking-плейсхолдер | `ThinkingMessage` (`@gravity-ui/aikit`)      | Видим, пока `streamStore.streaming === true`                |
| Markdown-рендер                 | `MarkdownRenderer` (`@gravity-ui/aikit`)     | Внутри `AssistantMessage`. **Raw HTML отключён**            |
| Логин-форма                     | `TextInput` + `Button` (`@gravity-ui/uikit`) | POST `/api/auth/verify` → `setToken`                        |

> Если `History` не поддерживает inline-rename — используем `Dialog` (uikit) с `TextInput`. Решение откладываем до интеграции — посмотрим API живьём.

> **Raw HTML в `MarkdownRenderer`:** при интеграции проверить, что рендерер не пропускает `<script>`/inline-обработчики; при необходимости добавить DOMPurify.

---

## Zustand-сторы

### `useAuthStore` (`stores/authStore.ts`)

```typescript
interface AuthStore {
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}
// persist: localStorage ключ 'auth-token'
// При получении HTTP 401 от любого API-вызова → clearToken() + redirect /login
```

### `useChatStore` (`stores/chatStore.ts`)

```typescript
interface ChatStore {
  chats: Chat[];
  activeChat: Chat | null;
  messages: Message[];
  fetchChats: () => Promise<void>;
  createChat: (title?: string) => Promise<Chat>;
  renameChat: (id: number, title: string) => Promise<void>;
  deleteChat: (id: number) => Promise<void>;
  setActive: (chat: Chat | null) => void;
  fetchMessages: (chatId: number) => Promise<void>;
  appendMessage: (msg: Message) => void; // вызывается из streamStore по 'done'
  patchChatTitle: (id: number, title: string) => void; // вызывается по 'done' если пришёл chatTitle
}
```

### `useStreamStore` (`stores/streamStore.ts`)

```typescript
interface StreamStore {
  streaming: boolean;
  partialContent: string;
  partialSources: Source[]; // накапливается из SSE-эвента 'sources' до 'done'
  error: { code: "auth" | "quota" | "server"; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  // внутри: api.postSSE с webSearch из settingsStore → парсинг →
  //   onSources → partialSources = sources;
  //   onDelta → partialContent += delta;
  //   onDone → appendMessage({..., sources: partialSources}) в chatStore,
  //            сброс partialContent/partialSources.
}
```

### `useSettingsStore` (`stores/settingsStore.ts`)

```typescript
interface SettingsStore {
  model: string;             // ID модели для отправки в POST body
  systemPrompt: string;      // пользовательский system prompt
  webSearch: boolean;        // тогл «Web» в композере, default false
  setModel: (m: string) => void;
  setSystemPrompt: (p: string) => void;
  setWebSearch: (v: boolean) => void;
}
// persist: localStorage ключ 'dexity-settings'
```

### `useThemeStore` (`stores/themeStore.ts`)

```typescript
interface ThemeStore {
  theme: "light" | "dark" | "system";
  setTheme: (t: "light" | "dark" | "system") => void;
}
// persist: localStorage ключ 'theme'
```

---

## SSE-парсер на клиенте (`services/stream.ts`)

```typescript
// Алгоритм:
// 1. fetch POST /api/chats/:chatId/messages/stream, body: JSON, headers: Bearer
// 2. response.body → ReadableStream<Uint8Array> → TextDecoderStream
// 3. Буфер: накапливаем chunks, режем по '\n\n'
// 4. Для каждого блока: snip 'data: ' → JSON.parse → SSEEvent
// 5. sources → callbacks.onSources(sources)  (приходит первым, если webSearch=true)
// 6. delta   → callbacks.onDelta(delta)
// 7. done    → callbacks.onDone(fullContent, assistantMessageId, chatTitle?)
// 8. error   → callbacks.onError(code, message)
// 8. response.ok === false перед открытием стрима:
//    401 → onError('auth', 'Unauthorized')
//    404 → onError('server', 'Chat not found')
//    прочее → onError('server', 'Network error')
```

> Используется `fetch` + `ReadableStream`, **не** `EventSource`. Причина: `EventSource` не поддерживает POST-запросы и заголовок `Authorization`.

Прерывание со стороны клиента (Stop) **в MVP не реализуется** — кнопки нет, `AbortController` не пробрасывается.

---

## Роутинг (`react-router-dom v6`)

```
/login         → LoginPage
                 Guard: если token есть → redirect /chat

/chat          → ChatPage (без activeChat → EmptyContainer + Suggestions)
                 Guard: если нет token → redirect /login

/chat/:chatId  → ChatPage с активным чатом
                 Guard: если нет token → redirect /login
                 Если chatId не существует (GET messages → 404) → redirect /chat
```

**UX-поведение:**
- Удаление активного чата → `DELETE` → redirect `/chat`, `activeChat = null`.
- Перезагрузка страницы во время стрима: клиент разрывает fetch, бэк дописывает ответ до конца и сохраняет в БД. При следующем `GET /messages` пользователь увидит полный ответ.

---

## Web search: рендер цитат и блока «Источники»

- Тогл «Web» (`Switch` uikit) живёт в `ChatComposer`, биндится на `settingsStore.webSearch`. При отправке `startStream` достаёт значение из стора и кладёт в POST body как `webSearch: true`.
- Во время стрима первый SSE-эвент при включённом тогле — `sources`; `streamStore.partialSources` заполняется до прихода `delta`. Блок «Источники» рендерится сразу, ещё до текста ответа.
- В `ChatStream.tsx` ассистент-сообщение с `sources` собирается из двух частей `content`: сначала `{ type: 'sources', data: { sources, messageId } }`, потом `{ type: 'text', data: { text: preprocessed } }`. Кастомный тип `sources` зарегистрирован через `createMessageRendererRegistry` + `registerMessageRenderer` (из `@gravity-ui/aikit`) и передан в `MessageList` через prop `messageRendererRegistry`.
- `utils/citations.ts` (`injectCitationLinks`) препроцессит текст: заменяет маркеры `[N]` (N=1..sources.length) на Markdown-линки `[\[N\]](#src-{messageId}-{N})`. Несуществующие маркеры (`[6]` при 5 источниках) остаются plain text. Во время стрима `messageId = 'streaming'`, после `done` — настоящий ID из БД.
- `SourcesBlock` рендерит вертикальный список карточек (`Card` uikit, нативный CSS, mobile-first). Якорь — `<a id="src-{messageId}-{position}">`. Клик по цитате в тексте → нативный scroll к якорю.
- При перезагрузке страницы `GET /messages` отдаёт `sources` внутри `Message`, `toAikitMessage` собирает тот же двухчастный `content` — цитаты и блок «Источники» рендерятся идентично свежему ответу.
