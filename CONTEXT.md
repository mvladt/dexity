# Context

Последнее обновление: 2026-05-07 15:00

## Что было сделано

- Проведено SDD-ревью `docs/dexity-spec.md` — найдено 5 критических проблем и 7 существенных замечаний
- Исправлена спека по результатам ревью (см. предыдущие записи)
- Реорганизована структура спек: `specs/overview.md`, `server/specs/backend.md`, `client/specs/frontend.md`
- **Написан весь код MVP:**
  - `shared/types.ts` — общие типы Chat, Message, SSEEvent
  - Бэкенд: config, DB (schema + migrate), auth plugin, routes (auth/chats/messages), LLM-сервис, точка входа
  - Фронтенд: все сторы (auth/chat/stream/theme), сервисы (api/stream), компоненты (ChatSidebar/ChatStream/ThemeSwitcher), страницы (LoginPage/ChatPage), App + роутинг
  - Деплой: nginx.conf, systemd unit, README

## Текущее состояние

Код полностью написан, TypeScript компилируется без ошибок (оба проекта).
Vite production build проходит.

Остались только smoke-тесты (шаги 6 и 12 плана):
- Шаг 6: curl-тест бэкенда (нужен `.env` с реальными ключами Yandex)
- Шаг 12: тест в браузере (нужно запустить оба сервера)

## Следующий шаг

`server/.env` и `client/.env` уже созданы. Провести smoke-тест:

```bash
mkdir -p server/data   # создать папку для SQLite (один раз)
cd server && npm run dev
# в другом терминале:
cd client && npm run dev
```

Smoke-тест плана:
- Шаг 6: curl логин → создать чат → отправить сообщение → прочитать SSE
- Шаг 12: полный цикл в браузере от логина до стриминга
