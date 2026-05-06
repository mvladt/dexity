# TODO — Dexity improvements

## Архитектура

- [ ] Добавить npm workspaces + `shared/` пакет с общими типами (`Chat`, `Message`, `SSEEvent`) — сейчас `types.ts` копируется вручную на клиент и сервер
- [ ] Перейти на `drizzle-kit` для управления миграциями (сейчас голый `db.exec(...)` при старте)

## Фичи

- [ ] Мульти-пользователь: каждый вводит свои `folderId` + `apiKey` от Yandex Cloud (схема БД уже подготовлена — поля в `users` закомментированы) [file:1]
- [ ] Stop-кнопка для прерывания стриминга (`AbortController`) [file:1]
- [ ] Persist `activeChat` — при перезагрузке страницы открывать последний активный чат [file:1]
- [ ] Увеличить лимит истории контекста (сейчас 20 сообщений — MVP) [file:1]
- [ ] Автогенерация заголовка чата — сейчас обрезается первые 50 символов сообщения, можно через отдельный LLM-вызов [file:1]

## DevOps

- [ ] CI/CD: автодеплой через `git pull && npm run build && systemctl restart dexity-server` (сейчас вручную) [file:1]
- [ ] Docker / Docker Compose (после MVP) [file:1]
