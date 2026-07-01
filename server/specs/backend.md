# Backend — спецификация

---

## Структура сервера (`server/`)

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
  "start": "node dist/server/src/index.js"
}
```

---

## Схема БД (SQLite + Drizzle ORM)

### Таблицы

```sql
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Зарезервировано для мульти-пользователя.
  -- В MVP одна строка (id=1), токен хранится в .env.
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

Без `drizzle-kit`. При старте сервера выполняется один SQL-блок через `db.exec(...)`. Файл — `server/src/db/migrate.ts`.

> Drizzle используется **только как query builder** (типобезопасные select/insert/update). Никаких CLI-инструментов и автогенерации миграций.

---

## API-эндпоинты (Fastify)

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
> **Принятый риск:** `ACCESS_TOKEN` хранится в `localStorage`. Вектор атаки через LLM-ответы закрыт отключением raw HTML в `MarkdownRenderer`. Дополнительная защита — CSP-заголовки в Nginx. Для личного однопользовательского инструмента этот уровень приемлем.

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

### Messages

| Метод  | Путь                                 | Auth | Описание                        |
| ------ | ------------------------------------ | :--: | ------------------------------- |
| `GET`  | `/api/chats/:chatId/messages`        |  ✅  | История сообщений               |
| `POST` | `/api/chats/:chatId/messages/stream` |  ✅  | Отправить сообщение → SSE-стрим |

**GET `/api/chats/:chatId/messages` Response 200:** `Message[]`, сортировка `createdAt ASC`.

**POST `/api/chats/:chatId/messages/stream` Request:**

```json
{
  "content": "string",
  "model": "string?",
  "systemPrompt": "string?",
  "webSearch": "boolean?",
  "timeZone": "string?"
}
```

`timeZone` — IANA-зона браузера (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Бэк всегда добавляет в `messages[]` первым **базовый системный блок** с текущей датой/временем: часы серверные (`new Date()`), формат — в присланной TZ (фоллбэк `Europe/Moscow` при отсутствии/невалидной зоне). Пользовательский `systemPrompt` идёт отдельным `system`-сообщением после него.

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

**Ошибки до открытия SSE:**

```json
HTTP 401: { "error": "Unauthorized" }
HTTP 404: { "error": "Chat not found" }
```

Клиент проверяет `response.ok` перед чтением стрима.

**Keep-alive:** каждые 15 секунд бэк шлёт SSE-комментарий:

```
: ping

```

Клиент игнорирует строки, начинающиеся с `:`. Поле `event:` не используется — только `data:`.

---

### Валидация запросов (Zod)

| Параметр / тело                 | Схема                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| `:chatId` (все маршруты)        | `z.coerce.number().int().positive()`                         |
| `POST /api/chats` body          | `z.object({ title: z.string().min(1).max(200).optional() })` |
| `PATCH /api/chats/:chatId` body | `z.object({ title: z.string().min(1).max(200) })`            |
| `POST …/messages/stream` body   | `{ content: 1..10_000, model?, systemPrompt?: ..4000, webSearch?, timeZone?: ..64 }` |
| `POST /api/auth/verify` body    | `z.object({ token: z.string().min(1) })`                     |

Fastify `bodyLimit: 102_400` (100 KB).

---

## Поток стриминга

```
POST /api/chats/:chatId/messages/stream
│
├── 1. Auth middleware → проверить Bearer token
├── 2. Проверить, что chat существует (404 если нет)
├── 3. Загрузить ПОСЛЕДНИЕ 20 сообщений чата:
│      SELECT * FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 20 → reverse
│      Если первое сообщение в окне — role='assistant' (пара разрезана LIMIT), отбросить его.
│      Запомнить userMessagesBefore = count(role='user') в этом окне (нужно для шага 10).
├── 4. Сохранить user-сообщение в БД (INSERT)
├── 5. Сформировать messages[] для LLM:
│      [ ...последние_20, { role: 'user', content: <новый текст> } ]
├── 6. Вызвать Yandex AI Studio через openai npm SDK:
│      const client = new OpenAI({
│        baseURL: 'https://llm.api.cloud.yandex.net/v1',
│        apiKey:  YC_API_KEY,
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

> **Контекст:** окно последних 20 сообщений из БД. Для MVP достаточно; при упоре в лимит токенов — добавим bookkeeping позже.
> **Прерывание стрима (пауза):** клиент закрывает соединение → `request.raw.on('close')` дёргает `AbortController`, который пробрасывается в `streamChat`/`webSearch`/`fetchUrl` (генерация у Yandex реально останавливается). Недописанный ответ **сохраняется в БД**: insert вынесен в `persistAssistant()`, который вызывается из `finally` при `aborted && !saved`. Пустой ответ (пауза до первого текста/инструмента) не сохраняется.

---

## Деплой

### Nginx (`nginx/dexity.conf`)

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

### systemd (`deploy/dexity-server.service`)

```ini
[Unit]
Description=AI Chat backend (Fastify)
After=network.target

[Service]
Type=simple
User=dexity
WorkingDirectory=/var/www/dexity/server
EnvironmentFile=/var/www/dexity/server/.env
ExecStart=/usr/bin/node dist/server/src/index.js
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

### CORS

`@fastify/cors` подключается **только в dev** (`NODE_ENV !== 'production'`) с `origin = process.env.CORS_ORIGIN`. На проде Nginx раздаёт фронт и API с одного домена — CORS не нужен.

`CORS_ORIGIN` обязателен в dev и валидируется в `config.ts` через Zod (`z.string().url()`). В production переменная игнорируется.
