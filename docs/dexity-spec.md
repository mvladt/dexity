# Спецификация: AI Chat — dexity.mvladt.ru

> SDD v3 · Node.js + Fastify · React 18 + GravityUI/AIKit · Только после подтверждения — переход к коду.

---

## 1. Структура проекта (monorepo)

```
dexity/
├── client/                  # React 18 + TypeScript + Vite
├── server/                  # Node.js + Fastify + SQLite
├── shared/
│   └── types.ts             # общие типы (Chat, Message, SSEEvent)
├── nginx/
│   └── dexity.conf
├── deploy/
│   ├── dexity-server.service   # systemd unit
│   └── README.md               # шпаргалка по деплою
├── .env.example
└── README.md
```

> Docker / Docker Compose — **не в MVP**. Деплой: Nginx reverse proxy + systemd unit на VPS.
> Монорепо без workspaces (два независимых `package.json`).

---

## 2. ENV-переменные

### Server (`server/.env`)

| Переменная         | Описание                                       | Пример                  |
| ------------------ | ---------------------------------------------- | ----------------------- |
| `PORT`             | Порт Fastify                                   | `3001`                  |
| `NODE_ENV`         | Режим (`development` / `production`)           | `production`            |
| `ACCESS_TOKEN`     | Единый токен авторизации                       | `mysecrettoken`         |
| `YANDEX_FOLDER_ID` | ID каталога Yandex Cloud                       | `b1gxxxxxxxx`           |
| `YANDEX_API_KEY`   | API-ключ Yandex Cloud (IAM или сервис-аккаунт) | `AQVN...`               |
| `MODEL_ID`         | ID модели (без folderId)                       | `qwen3-235b-a22b-fp8`   |
| `DATABASE_PATH`    | Путь к файлу SQLite                            | `./data/db.sqlite3`     |
| `CORS_ORIGIN`      | Origin для CORS (только в dev)                 | `http://localhost:5173` |

Полный model id формируется на бэке: `` `gpt://${YANDEX_FOLDER_ID}/${MODEL_ID}/latest` ``

> **Yandex AI Studio (OpenAI-совместимый API):**
>
> - `base_url = https://llm.api.cloud.yandex.net/v1`
> - Модель по умолчанию — `qwen3-235b-a22b-fp8` (Qwen3 MoE 235B / 22B активных, fp8). Поменять на `yandexgpt/latest` или другую — через `MODEL_ID`.

### Client (`client/.env`)

| Переменная     | Описание            | Пример                  |
| -------------- | ------------------- | ----------------------- |
| `VITE_API_URL` | Базовый URL бэкенда | `http://localhost:3001` |

---

## 3. Схема БД (SQLite + Drizzle ORM)

### Таблицы

```sql
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Зарезервировано для мульти-пользователя.
  -- В MVP одна строка (id=1), токен хранится в .env.
  -- folder_id TEXT,   -- будущее: folderId пользователя
  -- api_key   TEXT,   -- будущее: apiKey пользователя
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL DEFAULT 1,
  title      TEXT    NOT NULL DEFAULT 'Новый чат',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id      ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chats_user_id         ON chats(user_id);

-- Гарантируем существование дефолтного пользователя (user_id=1 в chats)
INSERT OR IGNORE INTO users (id) VALUES (1);
```

### Drizzle-схема (`server/src/db/schema.ts`)

```typescript
import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().default(1),
  title: text("title").notNull().default("Новый чат"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    chatIdx: index("idx_messages_chat_id").on(t.chatId),
  }),
);
```

### Миграция

Минималистично — без `drizzle-kit`. При старте сервера выполняется один SQL-блок (см. таблицы выше) через `db.exec(...)`. Файл — `server/src/db/migrate.ts`.

> Drizzle используется **только как query builder** (типобезопасные select/insert/update). Это полностью соответствует требованию минимализма — никаких CLI-инструментов и автогенерации миграций для одной-двух таблиц.

---

## 4. TypeScript-интерфейсы (общие)

Файл `shared/types.ts` — единый источник истины. Оба проекта импортируют из него через относительный путь:

```typescript
// server/src/types.ts  и  client/src/types.ts — тонкий re-export:
export type { Chat, Message, SSEEvent } from '../../shared/types'
```

`tsconfig.json` обоих проектов добавляет alias для прямых импортов:
```json
"paths": { "@shared/*": ["../shared/*"] }
```

```typescript
// shared/types.ts

export interface Chat {
  id: number;
  userId: number;
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface Message {
  id: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

// SSE-события стриминга
export type SSEEvent =
  | { type: "delta"; delta: string }
  | {
      type: "done";
      fullContent: string;
      assistantMessageId: number;
      chatTitle?: string;
    }
  | { type: "error"; code: "auth" | "quota" | "server"; message: string };
```

> `chatTitle` в `done` — присылается только если бэк только что обновил название чата (см. §6, шаг 10).

---

## 5. API-эндпоинты (Fastify)

Все маршруты, кроме `POST /api/auth/verify`, требуют `Authorization: Bearer <ACCESS_TOKEN>`.
Бэк отвечает `401 { error: 'Unauthorized' }` при неверном или отсутствующем токене.

### Auth

| Метод  | Путь               | Auth | Описание        |
| ------ | ------------------ | :--: | --------------- |
| `POST` | `/api/auth/verify` |  ❌  | Проверить токен |

**Request:** `{ "token": "string" }`
**Response 200:** `{ "ok": true }`
**Response 401:** `{ "ok": false, "error": "Invalid token" }`

> Фронт получает токен из формы → шлёт `POST /api/auth/verify` → если ok, кладёт в `localStorage`. Дальше все запросы идут с `Authorization: Bearer <token>`.
>
> **Принятый риск:** `ACCESS_TOKEN` хранится в `localStorage` и доступен любому JS на странице. Вектор атаки через LLM-ответы закрыт отключением raw HTML в `MarkdownRenderer` (§9). Дополнительная защита — CSP-заголовки в Nginx (§13.1). Для личного однопользовательского инструмента этот уровень приемлем.

---

### Chats

| Метод    | Путь                 | Auth | Описание      |
| -------- | -------------------- | :--: | ------------- |
| `GET`    | `/api/chats`         |  ✅  | Список чатов  |
| `POST`   | `/api/chats`         |  ✅  | Создать чат   |
| `PATCH`  | `/api/chats/:chatId` |  ✅  | Переименовать |
| `DELETE` | `/api/chats/:chatId` |  ✅  | Удалить       |

**GET `/api/chats` Response 200:** `Chat[]`, сортировка `updatedAt DESC`.

**POST `/api/chats` Request:** `{ "title"?: string }` (default: `"Новый чат"`)
**POST `/api/chats` Response 201:** `Chat`

**PATCH `/api/chats/:chatId` Request:** `{ "title": string }`
**PATCH `/api/chats/:chatId` Response 200:** `Chat`

**DELETE `/api/chats/:chatId` Response 200:** `{ "ok": true }`

---

### Валидация запросов (Zod)

| Параметр / тело                              | Схема                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| `:chatId` (все маршруты)                     | `z.coerce.number().int().positive()`                         |
| `POST /api/chats` body                       | `z.object({ title: z.string().min(1).max(200).optional() })` |
| `PATCH /api/chats/:chatId` body              | `z.object({ title: z.string().min(1).max(200) })`            |
| `POST …/messages/stream` body                | `z.object({ content: z.string().min(1).max(10_000) })`       |
| `POST /api/auth/verify` body                 | `z.object({ token: z.string().min(1) })`                     |

Fastify `bodyLimit: 102_400` (100 KB).

---

### Messages

| Метод  | Путь                                 | Auth | Описание                        |
| ------ | ------------------------------------ | :--: | ------------------------------- |
| `GET`  | `/api/chats/:chatId/messages`        |  ✅  | История сообщений               |
| `POST` | `/api/chats/:chatId/messages/stream` |  ✅  | Отправить сообщение → SSE-стрим |

**GET `/api/chats/:chatId/messages` Response 200:** `Message[]`, сортировка `createdAt ASC`.

**POST `/api/chats/:chatId/messages/stream` Request:**

```json
{ "content": "string" }
```

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Формат SSE-событий:**

```
data: {"type":"delta","delta":"Привет"}

data: {"type":"delta","delta":", мир"}

data: {"type":"done","fullContent":"Привет, мир","assistantMessageId":42,"chatTitle":"Привет"}
```

При ошибке:

```
data: {"type":"error","code":"quota","message":"Yandex API quota exceeded"}
```

**Маппинг ошибок LLM → SSE `code`:**

| HTTP от Yandex     | `code`   | Текст для UI                                 |
| ------------------ | -------- | -------------------------------------------- |
| `401`, `403`       | `auth`   | «Неверный API-ключ или нет доступа к модели» |
| `429`              | `quota`  | «Лимит запросов исчерпан»                    |
| `5xx`, network err | `server` | «Сервис недоступен, попробуйте позже»        |

**Ошибки до открытия SSE (шаги 1–2 в §6):**

Если ошибка возникла до установки SSE-соединения, бэк возвращает обычный HTTP-ответ:

```json
HTTP 401: { "error": "Unauthorized" }
HTTP 404: { "error": "Chat not found" }
```

Клиент проверяет `response.ok` перед чтением стрима и маппит на `onError`.

**Keep-alive:**

Каждые 15 секунд бэк шлёт SSE-комментарий для предотвращения таймаута Nginx:

```
: ping

```

Клиент игнорирует строки, начинающиеся с `:`. Поле `event:` не используется — только `data:`.

> **Реализация на клиенте:** используется `fetch` + `ReadableStream`, **не** `EventSource`. Причина: `EventSource` не поддерживает POST-запросы и заголовок `Authorization`.

---

## 6. Поток стриминга (Server-side)

```
POST /api/chats/:chatId/messages/stream
│
├── 1. Auth middleware → проверить Bearer token
├── 2. Проверить, что chat существует (404 если нет)
├── 3. Загрузить ПОСЛЕДНИЕ 20 сообщений чата:
│      SELECT * FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 20  → reverse
│      Если первое сообщение в окне — role='assistant' (пара разрезана LIMIT), отбросить его.
│      Запомнить userMessagesBefore = count(role='user') в этом окне (нужно для шага 10).
│      (стратегия контекста на MVP: окно по количеству, без учёта токенов)
├── 4. Сохранить user-сообщение в БД (INSERT)
├── 5. Сформировать messages[] для LLM:
│      [ ...последние_20, { role: 'user', content: <новый текст> } ]
├── 6. Вызвать Yandex AI Studio через openai npm SDK:
│      const client = new OpenAI({
│        baseURL: 'https://llm.api.cloud.yandex.net/v1',
│        apiKey:  YANDEX_API_KEY,
│      })
│      const stream = await client.chat.completions.create({
│        model:   `gpt://${FOLDER_ID}/${MODEL_ID}/latest`,
│        messages,
│        stream:  true,
│      })
├── 7. Открыть SSE-ответ (set headers, reply.raw.write).
├── 8. Итерация по чанкам:
│      for await (const chunk of stream) {
│        const delta = chunk.choices[0]?.delta?.content ?? ''
│        if (delta) writeSSE({ type: 'delta', delta }); fullContent += delta;
│      }
├── 9. INSERT assistant-сообщения в БД, UPDATE chats SET updated_at=datetime('now').
│      (updated_at обновляется после стрима — чат поднимается в сайдбаре по завершении ответа)
├── 10. Авто-заголовок (только если userMessagesBefore === 0, т.е. это первый user-запрос):
│       text = user.content.trim().replace(/\s+/g, ' ')
│       Обрезать по последнему пробелу до 50 символов, добавить '…'
│       UPDATE chats SET title=title, updated_at=datetime('now').
├── 11. writeSSE({ type: 'done', fullContent, assistantMessageId, chatTitle? }).
└── 12. reply.raw.end().

При исключении на любом шаге после открытия SSE:
   writeSSE({ type: 'error', code, message }); reply.raw.end()
```

> **Контекст:** окно последних 20 сообщений из БД. Решение принято для простоты MVP. Если упрёмся в лимит токенов — добавим bookkeeping позже.
> **Прерывание стрима пользователем:** не реализуется в MVP. Нет кнопки Stop, нет `AbortController`. Если клиент закрыл соединение, стрим идёт до конца на бэке, ассистент-сообщение всё равно сохраняется в БД.
> **Responses API / `previous_response_id`:** не используется (стек: Chat Completions API).

---

## 7. Структура сервера (`server/`)

```
server/
├── src/
│   ├── index.ts              # точка входа: Fastify, плагины, listen
│   ├── config.ts             # читает .env, валидирует через zod, экспортирует типизированный конфиг
│   ├── db/
│   │   ├── client.ts         # better-sqlite3 + Drizzle
│   │   ├── schema.ts         # Drizzle-схема
│   │   └── migrate.ts        # db.exec(CREATE TABLE IF NOT EXISTS ...)
│   ├── plugins/
│   │   ├── auth.ts           # preHandler hook: Bearer token check
│   │   └── cors.ts           # @fastify/cors, только если NODE_ENV=development
│   ├── routes/
│   │   ├── auth.ts           # POST /api/auth/verify
│   │   ├── chats.ts          # CRUD чатов
│   │   └── messages.ts       # GET history + POST stream
│   ├── services/
│   │   └── llm.ts            # OpenAI-клиент + streamChat(messages[])
│   └── types.ts              # re-export из shared/types.ts
├── data/                     # .gitignore: db.sqlite3
├── package.json
└── tsconfig.json
```

**Зависимости (`server/package.json`):**

```json
{
  "dependencies": {
    "fastify": "^5",
    "@fastify/cors": "^10",
    "better-sqlite3": "^11",
    "drizzle-orm": "^0.38",
    "openai": "^4",
    "dotenv": "^16",
    "zod": "^3"
  },
  "devDependencies": {
    "tsx": "^4",
    "@types/better-sqlite3": "^7",
    "@types/node": "^22",
    "typescript": "^5"
  }
}
```

> Никакого `drizzle-kit` — миграция одной командой `db.exec(...)` при старте.

**`tsconfig.json`:** `"module": "NodeNext"`, `"target": "ES2022"`, `"strict": true`, `"paths": { "@shared/*": ["../shared/*"] }`.

> **`dotenv`:** `dotenv.config()` вызывается только при `NODE_ENV !== 'production'` — в production переменные проставляет systemd `EnvironmentFile`.

> **Логирование:** Fastify logger включён (`logger: { level: 'info' }` в prod, `'debug'` в dev). Ошибки Yandex API логируются с телом ответа перед маппингом в SSE `error`.

> **`package-lock.json`** коммитится в репо.

**Скрипты `package.json`:**

```json
"scripts": {
  "dev":   "tsx watch src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js"
}
```

---

## 8. Структура клиента (`client/`)

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
│   │   ├── ChatStream.tsx        # MessageList + ThinkingMessage + PromptInput
│   │   └── ThemeSwitcher.tsx     # переключатель темы
│   ├── stores/
│   │   ├── authStore.ts          # Zustand: token (persist localStorage)
│   │   ├── chatStore.ts          # Zustand: chats, activeChat, messages
│   │   ├── streamStore.ts        # Zustand: streaming, partialContent
│   │   └── themeStore.ts         # Zustand: theme (persist localStorage)
│   ├── services/
│   │   ├── api.ts                # fetch-обёртка (VITE_API_URL + Bearer)
│   │   └── stream.ts             # SSE-парсер через ReadableStream
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

## 9. Компоненты фронта и маппинг AIKit

> Версия `@gravity-ui/aikit ~1.17` — все компоненты ниже **проверены в исходниках пакета** (`build/esm/components/` после `npm i`). Используется `~` (patch-диапазон) — миноры могут изменить API компонентов.

| Блок                            | Компонент (импорт)                           | Поведение                                                  |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Провайдер темы                  | `ThemeProvider` (`@gravity-ui/uikit`)        | `theme` из `themeStore` (`light` / `dark` / `system`)      |
| Переключатель темы              | `Switch` (`@gravity-ui/uikit`)               | Меняет `theme` в `themeStore`                              |
| Корневой лейаут чата            | `ChatContainer` (`@gravity-ui/aikit`)        | Композит: header + content + input                         |
| Список сообщений                | `MessageList` (`@gravity-ui/aikit`)          | Принимает массив сообщений                                 |
| Сообщение ассистента            | `AssistantMessage` (`@gravity-ui/aikit`)     | Внутри — `MarkdownRenderer`. `isThinking` во время стрима  |
| Сообщение пользователя          | `UserMessage` (`@gravity-ui/aikit`)          | Plain text                                                 |
| Поле ввода                      | `PromptInput` (`@gravity-ui/aikit`)          | `onSubmit`, `disabled` во время стрима                     |
| Сайдбар (история чатов)         | `History` (`@gravity-ui/aikit`)              | `items[]`, действия `onSelect`/`onRename`/`onDelete`       |
| Пустое состояние                | `EmptyContainer` (`@gravity-ui/aikit`)       | Показывается на `/chat` без активного чата                 |
| Подсказки на пустом экране      | `Suggestions` (`@gravity-ui/aikit`)          | Perplexity-стайл квик-старт промпты (3-4 шт. захардкожены) |
| Стриминг / thinking-плейсхолдер | `ThinkingMessage` (`@gravity-ui/aikit`)      | Видим, пока `streamStore.streaming === true`               |
| Markdown-рендер                 | `MarkdownRenderer` (`@gravity-ui/aikit`)     | Внутри `AssistantMessage`. **Raw HTML отключён** — при интеграции проверить, что рендерер не пропускает `<script>`/inline-обработчики; при необходимости добавить DOMPurify |
| Логин-форма                     | `TextInput` + `Button` (`@gravity-ui/uikit`) | POST `/api/auth/verify` → `setToken`                       |

> Если `History` не поддерживает inline-rename — используем `Dialog` (uikit) с `TextInput` для редактирования. Решение откладываем до интеграции — посмотрим API живьём.

---

## 10. Zustand-сторы

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
  error: { code: "auth" | "quota" | "server"; message: string } | null;
  startStream: (chatId: number, content: string) => Promise<void>;
  // внутри: api.postSSE → парсинг → updates partialContent → on 'done' пушит в chatStore
}
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

## 11. SSE-парсер на клиенте (`services/stream.ts`)

```typescript
// Алгоритм:
// 1. fetch POST /api/chats/:chatId/messages/stream, body: JSON, headers: Bearer
// 2. response.body → ReadableStream<Uint8Array> → TextDecoderStream
// 3. Буфер: накапливаем chunks, режем по '\n\n'
// 4. Для каждого блока: snip 'data: ' → JSON.parse → SSEEvent
// 5. delta → callbacks.onDelta(delta)
// 6. done  → callbacks.onDone(fullContent, assistantMessageId, chatTitle?)
// 7. error → callbacks.onError(code, message)
// 8. response.ok === false перед открытием стрима:
//    401 → onError('auth', 'Unauthorized')
//    404 → onError('server', 'Chat not found')
//    прочее → onError('server', 'Network error')
```

Прерывание со стороны клиента (Stop) **в MVP не реализуется** — кнопки нет, `AbortController` не пробрасывается.

---

## 12. Роутинг фронта (`react-router-dom v6`)

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

## 13. Деплой

### 13.1. Nginx (`nginx/dexity.conf`)

```nginx
server {
    listen 80;
    server_name dexity.mvladt.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name dexity.mvladt.ru;

    ssl_certificate     /etc/letsencrypt/live/dexity.mvladt.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dexity.mvladt.ru/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Content-Security-Policy   "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" always;

    # Фронт (собранный dist, отдаётся статикой)
    location / {
        root /var/www/dexity/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API и SSE → Fastify
    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Обязательно для SSE:
        proxy_buffering          off;
        proxy_cache              off;
        proxy_read_timeout       300s;
        proxy_set_header         Connection '';
        chunked_transfer_encoding on;
    }
}
```

### 13.2. systemd (`deploy/dexity-server.service`)

```ini
[Unit]
Description=AI Chat backend (Fastify)
After=network.target

[Service]
Type=simple
User=dexity
WorkingDirectory=/var/www/dexity/server
EnvironmentFile=/var/www/dexity/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Команды установки:**

```bash
sudo cp deploy/dexity-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dexity-server
sudo journalctl -u dexity-server -f   # логи
```

### 13.3. CORS

`@fastify/cors` подключается **только в dev** (`NODE_ENV !== 'production'`) с `origin = process.env.CORS_ORIGIN`. На проде Nginx раздаёт фронт и API с одного домена — CORS не нужен.

`CORS_ORIGIN` обязателен в dev и валидируется в `config.ts` через Zod (`z.string().url()`). В production переменная игнорируется.

---

## 14. Что не входит в MVP

- Docker / Docker Compose
- Мульти-пользовательская авторизация (таблица `users` зарезервирована)
- Поиск по чатам
- Загрузка файлов / изображений
- Экспорт истории
- **Кнопка Stop** для прерывания стрима (откладываем)
- **Persist activeChat** между перезагрузками (откладываем)
- LLM-генерация заголовка чата (в MVP — обрезка первого сообщения по 50 символов)
- Учёт токенов в истории (в MVP — окно последних 20 сообщений)
- CI/CD (деплой вручную: `git pull && npm run build && systemctl restart dexity-server`)
- SSE reconnect / `Last-Event-ID`
- Синхронизация между вкладками (multi-tab)
- Тесты (unit / e2e)

---

## 15. Пользовательские сценарии

Ключевые сценарии, которые должны работать в MVP. Служат основой для E2E и integration-тестов.

### Аутентификация

| # | Сценарий                                                           | Ожидаемый результат                          |
| - | ------------------------------------------------------------------ | -------------------------------------------- |
| 1 | Ввести верный токен на `/login`                                     | Редирект на `/chat`                          |
| 2 | Ввести неверный токен на `/login`                                   | Сообщение об ошибке, остаёмся на `/login`    |
| 3 | Залогиненный пользователь открывает `/login`                        | Редирект на `/chat`                          |
| 4 | Незалогиненный пользователь открывает `/chat`                       | Редирект на `/login`                         |
| 5 | Сервер вернул `401` на любом запросе после логина                   | Авто-логаут, редирект на `/login`            |

### Управление чатами

| #  | Сценарий                                      | Ожидаемый результат                                     |
| -- | --------------------------------------------- | ------------------------------------------------------- |
| 6  | Создать новый чат                             | Чат появляется в сайдбаре, открывается                  |
| 7  | Переименовать чат                             | Новое название сохраняется и отображается в сайдбаре    |
| 8  | Удалить неактивный чат                        | Чат исчезает из сайдбара                                |
| 9  | Удалить активный чат                          | Редирект на `/chat`, `activeChat = null`                 |

### Сообщения и стриминг

| #  | Сценарий                                                                 | Ожидаемый результат                                              |
| -- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 10 | Отправить сообщение в чат                                                | Текст ответа появляется по частям (стрим), затем фиксируется    |
| 11 | Первое сообщение в новом чате                                            | Заголовок чата обновился автоматически в сайдбаре               |
| 12 | Второе и последующие сообщения в чате                                    | Заголовок чата не изменился                                      |
| 13 | Yandex API вернул ошибку `429` (quota)                                   | Пользователь видит «Лимит запросов исчерпан»                    |
| 14 | Yandex API вернул ошибку `401`/`403` (auth)                              | Пользователь видит «Неверный API-ключ или нет доступа к модели» |
| 15 | Перезагрузить страницу во время стрима, затем вернуться в чат            | Виден полный сохранённый ответ ассистента                        |

### Навигация и состояние

| #  | Сценарий                                                      | Ожидаемый результат                               |
| -- | ------------------------------------------------------------- | ------------------------------------------------- |
| 16 | Открыть `/chat` без активного чата                            | Пустой экран с подсказками (`Suggestions`)        |
| 17 | Кликнуть на подсказку (`Suggestions`)                         | Создаётся чат, промпт отправляется автоматически  |
| 18 | Перейти на `/chat/:несуществующийId`                          | Редирект на `/chat`                               |
| 19 | Переключить тему (light/dark) и перезагрузить страницу        | Тема сохранилась                                  |

### Контекст LLM

| #  | Сценарий                                                                              | Ожидаемый результат                                                    |
| -- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 20 | Чат с >20 сообщениями — отправить ещё одно                                            | Запрос уходит без ошибки; окно контекста не содержит оборванных пар    |

---

## 16. Порядок реализации (после подтверждения)

1. `shared/types.ts` — единый файл общих типов
2. `server/` — `package.json`, `tsconfig.json`, `config.ts`, `db/{client,schema,migrate}.ts`
3. `server/plugins/auth.ts` + `routes/auth.ts`
4. `server/routes/chats.ts` — CRUD
5. `server/services/llm.ts` + `routes/messages.ts` — стриминг + авто-заголовок
6. **Smoke-тест бэка через `curl`** (логин, создать чат, отправить сообщение, прочитать SSE)
7. `client/` — `package.json`, `vite.config.ts`, bootstrap (`main.tsx`, `App.tsx`)
8. `client/stores/` — все четыре стора
9. `client/services/{api,stream}.ts`
10. `client/pages/LoginPage.tsx` + Guard
11. `client/pages/ChatPage.tsx` + `components/{ChatSidebar,ChatStream,ThemeSwitcher}.tsx`
12. **Smoke-тест в браузере** (полный цикл)
13. `nginx/dexity.conf` + `deploy/dexity-server.service` + README по деплою

---

> **Жду подтверждения.** После него — реализация пошагово, файл за файлом, начиная с бэка.
