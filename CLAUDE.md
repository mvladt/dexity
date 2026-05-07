# Dexity — AI Chat

Клон Perplexity.ai для личного использования. Подход: SDD — сначала спецификация, потом код.

## Стек

- **Frontend:** React 18, TypeScript, Vite, Zustand, `@gravity-ui/uikit` + `@gravity-ui/aikit`
- **Backend:** Node.js, Fastify, SQLite, Drizzle ORM, Zod
- **LLM:** Yandex Cloud AI Studio (OpenAI-совместимый SDK)

## Структура

```
dexity/
├── client/   # React + Vite (FSD-архитектура)
├── server/   # Fastify + SQLite (feature-modules)
├── nginx/
└── deploy/
```

Монорепо **без workspaces** — два независимых `package.json`.

## Критичные решения

- **Model ID** формируется на бэке: `` `gpt://${YANDEX_FOLDER_ID}/${MODEL_ID}/latest` ``
- **Drizzle** — только как query builder (типобезопасные select/insert/update). Без `drizzle-kit`, без CLI-миграций. Миграция — один `db.exec(...)` при старте (`server/src/db/migrate.ts`)
- **Стриминг** — SSE: бэк проксирует поток от Yandex, фронт читает через `fetch` + `ReadableStream` (не `EventSource` — не поддерживает POST и `Authorization`)
- **Контекст LLM** — бэк загружает полную историю из SQLite и передаёт в `messages[]` при каждом запросе
- **Аутентификация** — единый `ACCESS_TOKEN` в `.env`; `Authorization: Bearer <token>`

## Ограничения (не нарушать)

- Не предлагать Docker / Docker Compose
- Не использовать npm workspaces
- UI-компоненты — только из `@gravity-ui/uikit` / `@gravity-ui/aikit`. Кастомный компонент — только если аналога нет, с явным обоснованием

## Команды

```bash
cd server && npm run dev
cd client && npm run dev
```

## ENV

`server/.env`: `PORT`, `NODE_ENV`, `ACCESS_TOKEN`, `YANDEX_FOLDER_ID`, `YANDEX_API_KEY`, `MODEL_ID`, `DATABASE_PATH`, `CORS_ORIGIN`  
`client/.env`: `VITE_API_URL`

## Спецификация

Полное описание API, схемы БД, TypeScript-интерфейсов, Zustand-сторов, Nginx — в `dexity-spec.md`.

## Контекст сессий

- Обновляй `CONTEXT.md` по ходу работы и в конце сессии: что сделано, текущее состояние, следующий шаг. Временная метка — дата и время (`2026-05-07 18:42`).
- Делай коммиты после каждого завершённого логического шага, не копи изменения до конца сессии.
