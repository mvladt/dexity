# План реализации Dexity

Основан на `specs/overview.md`, `server/specs/backend.md`, `client/specs/frontend.md`. Реализация пошагово, файл за файлом.

## Бэкенд

- [x] 1. `shared/types.ts` — единый файл общих типов
- [x] 2. `server/package.json`, `tsconfig.json`, `src/config.ts`, `src/db/{client,schema,migrate}.ts`
- [x] 3. `server/src/plugins/auth.ts` + `src/routes/auth.ts`
- [x] 4. `server/src/routes/chats.ts` — CRUD чатов
- [x] 5. `server/src/services/llm.ts` + `src/routes/messages.ts` — стриминг + авто-заголовок
- [x] 6. **Smoke-тест через `curl`**: логин → создать чат → отправить сообщение → прочитать SSE

## Фронтенд

- [x] 7. `client/package.json`, `vite.config.ts`, bootstrap (`main.tsx`, `App.tsx`)
- [x] 8. `client/src/stores/` — все четыре Zustand-стора
- [x] 9. `client/src/services/{api,stream}.ts`
- [x] 10. `client/src/pages/LoginPage.tsx` + Route Guard
- [x] 11. `client/src/pages/ChatPage.tsx` + компоненты: `ChatSidebar`, `ChatStream`, `ThemeSwitcher`
- [x] 12. **Smoke-тест в браузере**: полный цикл от логина до стриминга

## Деплой

- [x] 13. `nginx/dexity.conf` + `deploy/dexity-server.service` + README по деплою
