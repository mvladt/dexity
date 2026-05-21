# Dexity — AI Chat

Персональный AI-чат на базе Yandex Cloud AI Studio. Клон Perplexity.ai для личного использования.

## Стек

| Слой     | Технологии                                              |
| -------- | ------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, Zustand, GravityUI/AIKit    |
| Backend  | Node.js, Fastify, SQLite, Drizzle ORM, Zod              |
| LLM      | Yandex Cloud AI Studio (OpenAI-совместимый API, Qwen3)  |
| Деплой   | Nginx + systemd на VPS                                  |

## Структура

```
dexity/
├── client/   # React + Vite (FSD-архитектура)
├── server/   # Fastify + SQLite
├── shared/   # Общие TypeScript-типы
├── specs/    # SDD-спецификации
├── nginx/
└── deploy/
```

## Запуск

```bash
# Backend
cd server && cp .env.example .env  # заполнить переменные
npm install && npm run dev

# Frontend
cd client && cp .env.example .env  # задать VITE_API_URL
npm install && npm run dev
```

## ENV

**`server/.env`**

| Переменная         | Описание                          |
| ------------------ | --------------------------------- |
| `PORT`             | Порт Fastify (напр. `3001`)       |
| `ACCESS_TOKEN`     | Единый токен авторизации          |
| `YC_FOLDER_ID` | ID каталога Yandex Cloud          |
| `YC_API_KEY`   | API-ключ Yandex Cloud             |
| `MODEL_ID`         | ID модели (напр. `qwen3-235b-a22b-fp8`) |
| `DATABASE_PATH`    | Путь к SQLite (напр. `./data/db.sqlite3`) |
| `CORS_ORIGIN`      | Origin фронта (только в dev)      |

**`client/.env`**

| Переменная     | Описание               |
| -------------- | ---------------------- |
| `VITE_API_URL` | URL бэкенда            |

## Деплой

Смотри [`deploy/README.md`](deploy/README.md).
