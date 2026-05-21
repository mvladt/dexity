# Результат: Web search + цитаты

План — `web-search-plan.md`. Здесь — что фактически сделано по этапам.

## Этап 0 — доступ к Yandex Search API v2

- SA `ajepn79g4psakc0u6f2a` (`ai-studio-e5b0ee`), роль `search-api.webSearch.user`.
- Отдельный API-ключ `aje64vb6rbt3o4100tt8` (scope `yc.search-api.execute`) → `YC_SEARCH_API_KEY` в `server/.env`.
- Проверка `curl` к `/v2/web/search` — валидный XML.

## Этап 1 — поиск работает изолированно

- `server/src/services/search.ts` — функция `webSearch(query, signal?): Promise<Source[]>`. Тип `Source` локально (на этапе 2 переедет в `shared/types.ts`).
- Добавлена зависимость `fast-xml-parser` в `server/package.json`.
- Расхождение с планом: `<hlword>` режется **до** парсинга XML — `fast-xml-parser` ломает inline mixed-content внутри `<title>`/`<passage>`. Зафиксировано в плане.
- Ручной тест (`npx tsx --env-file=.env -e "..."`) вернул 5 источников; у 3 из 5 непустой snippet (норма для MVP).
- Лог ошибок — `console.error`. На этапе 2 в роуте можно прокинуть `fastify.log`.
