# Текущий контекст

## Чем занимались

Работа над фичей **#15 «Web search + цитаты»** из `docs/aikit-improvements-plan.md` — главная фишка, которая должна приблизить Dexity к Perplexity.

## Зафиксированные решения по архитектуре

- Провайдер — **Yandex Search API v2** (REST `https://searchapi.api.cloud.yandex.net/v2/web/search`). Старый v1 (`yandex.com/search/xml`) выключен (`error 4002`).
- Триггер — **ручной тогл «Web»** в `ChatComposer` (не auto, не tool-calling)
- Глубина — **только снипы** топ-5 (продвинутый режим с парсингом HTML добавлен в `TODO.md` как «Pro Search»)
- Цитаты — **своя реализация**: маркеры `[N]` → Markdown-линки на якоря в блоке «Источники». `InlineCitation` из aikit использовать нельзя — компонент пустой (`export {}`).
- Парсер XML — `fast-xml-parser` (ответ v2 = JSON `{rawData: base64}`, внутри base64 — тот же XML, что и в v1; парсить руками = антипаттерн)

## Доступы к Yandex Search API v2 (этап 0)

- **SA** для Search API: `ajepn79g4psakc0u6f2a` (`ai-studio-e5b0ee`) — тот же, что держит текущий `YC_API_KEY` для AI Studio.
- **Роль:** `search-api.webSearch.user` (НЕ `search-api.executor` — устарела, для v1).
- **API-ключ:** **отдельный** от `YC_API_KEY`, со scope `yc.search-api.execute`. В `.env` — `YC_SEARCH_API_KEY`.
- Лимиты по умолчанию: 10 RPS / 10 000 запросов в час sync.

## Где остановились

**Этап 0 пройден.** SA `ajepn79g4psakc0u6f2a`, роль `search-api.webSearch.user`, API-ключ `aje64vb6rbt3o4100tt8` (scope `yc.search-api.execute`) лежит в `server/.env` как `YC_SEARCH_API_KEY`. Проверочный POST к `/v2/web/search` отдал валидный XML с результатами.

Готов стартовать **Этап 1** — установка `fast-xml-parser` в `server/`, реализация `server/src/services/search.ts`, ручной тест через `npx tsx`.

## Дальнейшие шаги (после этапа 0)

- **Этап 1:** `cd server && npm install fast-xml-parser`, реализовать `server/src/services/search.ts` (POST к v2, base64-декод rawData, XML-парс), ручной тест через `npx tsx`.
- **Этап 2:** миграция таблицы `sources`, расширение типов (`shared/types.ts`), изменения в роуте `messages/stream`, `GET /messages` отдаёт sources.
- **Этап 3:** тогл «Web» во фронте, SSE-обработка `sources`-эвента, кастомный renderer для блока «Источники», препроцесс цитат `[N]`.
- **Этап 4:** CSS + smoke E2E (Playwright).

Подробности — в `docs/web-search-plan.md`.
