# Context

Последнее обновление: 2026-05-07 14:30

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

Настроить `.env` для сервера и провести smoke-тест:
```bash
cd server && cp .env.example .env  # заполнить ключи
npm run dev
```
Затем тест в браузере (`cd client && npm run dev`).
