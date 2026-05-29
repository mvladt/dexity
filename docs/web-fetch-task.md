# Tool `web_fetch` — чтение полной страницы

Связано: `docs/archive/agentic-web-search-plan.md` (тот же round-loop, та же SSE-схема `tool`-эвентов).

## Зачем

`web_search` возвращает 5 источников по 400 символов сниппета. Этого хватает для фактоидов, но мало для:

- разбора/суммаризации страницы по ссылке от юзера («что в этой статье?»);
- докрутки после поиска, когда модели нужен полный текст одного из найденных результатов.

Решение — второй tool рядом с `web_search`. Модель сама решает: искать → читать → отвечать.

## Скоуп MVP

Только **статьи**: блоги, документация, новости, Wikipedia, README. Используем `@mozilla/readability` + `linkedom` — алгоритм Firefox Reader Mode. Что не «статья» (товарные карточки, форумы, ленты соцсетей, SPA без SSR) — в скоуп v1 **не входит**: readability вернёт пустой результат, и это ожидаемо.

Если позже захочется покрыть e-commerce/SPA — это отдельные таски: JSON-LD / OpenGraph extractor, headless-браузер. Не v1.

## Архитектура

Новых концепций не вводим — всё ложится в существующий round-loop `messages.ts:125-243`.

### Backend

Новый сервис `server/src/services/fetch.ts`:

- `webFetchTool: ChatCompletionTool` со схемой `{ url: string }`.
- `fetchUrl(url, signal): Promise<{ url, title, content }>`.

Пайплайн `fetchUrl`:

1. **Валидация URL** (см. «Безопасность» ниже).
2. **HTTP GET** с `redirect: 'manual'`, ручной цикл редиректов — до 5 шагов, на каждом перевалидация URL.
3. **Проверка `Content-Type`** — только `text/html` или `application/xhtml+xml`. Иначе ошибка.
4. **Стриминговое чтение body** с обрывом при превышении 2MB.
5. **Парсинг**: `parseHTML(html)` (linkedom) → `new Readability(document).parse()`.
6. Если `null` или `textContent` пустой — ошибка «не удалось извлечь читаемый контент». Модель увидит её в tool-response и решит, что делать.
7. **Обрезка контента**: `article.textContent` (plain text, без markdown в v1), хвост >15k символов → `…[обрезано]`.
8. Возврат `{ url, title: article.title, content }`.

Прочее:

- Timeout 10с (`AbortSignal.timeout` + переданный `signal`).
- User-Agent — нейтральный (`Mozilla/5.0 ... Dexity/1.0`).

В `messages.ts`:

- `tools` массив теперь `[webSearchTool, webFetchTool]` (когда `webSearchEnabled && !final`).
- В диспатчере tool_call'ов — ветка `if (tc.name === 'web_fetch')`: парсим args.url, шлём SSE `{type:'tool', tool:{name:'fetch', status:'loading', callId, url}}`, дёргаем `fetchUrl`, шлём `success` с `{title}` или `error`.
- В `llmMessages` добавляем `{role:'tool', tool_call_id, content: JSON({url, title, content})}`.
- **Параллельный fetch:** заменить последовательный `for (const tc of toolCallsList)` на `Promise.allSettled`. `loading`-эвенты шлём сразу пачкой в порядке callId, `success/error` — по мере резолва каждого промиса.
- **Дедуп**: `Map<string, Promise<FetchResult>>` на жизнь хендлера. Ключ — `new URL(url).toString()` (нормализованный). Если тот же URL уже фетчили в этом ответе — отдаём кэшированный промис мгновенно.
- **Soft cap**: константа `MAX_FETCHES_PER_RESPONSE = 20` рядом с `MAX_ROUNDS`. Счётчик в хендлере. После исчерпания tool возвращает error «лимит fetch'ей исчерпан, заверши ответ».

### Безопасность

Развёртывание — VPS, поэтому SSRF и DoS критичны.

**SSRF-блок (на каждом hop редиректа):**

- Протокол: только `http://` / `https://`. Никаких `file://`, `ftp://`, `data:`, `gopher:` и пр.
- Хосты в чёрном списке: `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local + cloud metadata), `::1`, `fc00::/7`.
- Реализация: `new URL(url)` + `node:net.isIP` + проверка против CIDR-списка. Без новых зависимостей.

**Редиректы:**

- `fetch(..., { redirect: 'manual' })`. Если 3xx — читаем `Location`, прогоняем через SSRF-блок, инкрементим счётчик. Лимит 5 редиректов, дальше ошибка.

**DoS:**

- Streaming-чтение body через `response.body.getReader()` с ручным счётчиком байт. На превышении 2MB — `reader.cancel()` и ошибка. Не использовать `response.text()` / `arrayBuffer()` — они читают всё в память до проверки.
- Ранний exit, если `Content-Length` в headers > 2MB (не доверяя, но как быстрый отсев).
- `Content-Type` фильтр (см. пайплайн выше).

**Известные ограничения (не закрыто в v1):**

- DNS rebinding (TOCTOU при resolve hostname). В нашей модели угроз — низкий риск (нет внешнего злоумышленника, который мог бы заставить модель пойти на свой домен). Зафиксировано в `TODO.md`.

### Shared types

`shared/types.ts`:

- `SSEEvent.tool.name`: `'web' | 'fetch'`.
- При `name:'fetch'` добавляются поля: `url: string`, `title?: string` (только в `success`).
- Для долгосрочного хранения — расширить `PartSnapshot`:
  ```ts
  | { type: 'fetch'; url: string; title: string }
  ```
  Полный контент в БД **не пишем** — он одноразовый, занимает место. Только URL+title, чтобы при reload отрисовать «Прочитана страница: example.com».

### Frontend

- `streamStore.partialTools` — добавить вариант для fetch (`{kind:'fetch', url, title?, status}`).
- `ChatStream.toAikitMessage` — рендерить `ToolMessage` с `toolName:"Read"`, иконкой документа/линка, `headerContent: url`, `bodyContent: title` (если есть).
- Никакого нового settings-флага — если `webSearchEnabled`, оба tool'а доступны вместе. Разделение «только поиск / только фетч» не нужно.

## Что НЕ делаем

- **Fallback на «тупой strip»** если readability вернула null. v1 — только статьи; если не вышло, модель видит честную ошибку.
- **JSON-LD / OpenGraph extractor** для товаров, рецептов, etc. — отдельная фича, не сейчас.
- **Headless-рендер** (playwright/puppeteer) для SPA — другой проект целиком.
- **Парсинг PDF/DOCX** по ссылке.
- **Markdown-конверсия** контента (turndown). Только plain text в v1.
- **Кэш между assistant-ответами** (только в рамках одного).
- **DNS rebinding защита** — записано в `TODO.md`.
- **Отдельный тогл «Web Fetch»** в UI — идёт в комплекте с `webSearchEnabled`.

## План

- [ ] 1. Подключить `@mozilla/readability` и `linkedom` в `server/package.json`.
- [ ] 2. Создать `server/src/services/fetch.ts`: `webFetchTool` + `fetchUrl()` с readability/linkedom, SSRF-блоком (`http(s)`-only, чёрный список приватных подсетей), ручным циклом редиректов (max 5, валидация каждого hop), стриминговым чтением с лимитом 2MB, фильтром `Content-Type`, timeout 10с.
- [ ] 3. Расширить SSE-схему в `shared/types.ts`: `tool.name: 'web' | 'fetch'`, поля `url`/`title`. Расширить `PartSnapshot` вариантом `fetch`.
- [ ] 4. В `messages.ts` — добавить `webFetchTool` в массив `tools`, добавить ветку обработки `tc.name === 'web_fetch'`, заменить последовательный цикл tool_call'ов на `Promise.allSettled` (параллельно), дедуп через `Map<normalizedUrl, Promise>`, soft cap `MAX_FETCHES_PER_RESPONSE = 20`.
- [ ] 5. `streamStore` — поддержать `{kind:'fetch', ...}` в `partialTools`, прокинуть `url`/`title` через SSE-парсер.
- [ ] 6. `ChatStream.toAikitMessage` — рендер `ToolMessage` с лейблом `Read` для fetch-партов (и live, и из истории).
- [ ] 7. Добавить пункт про DNS rebinding в `TODO.md`.
- [ ] 8. Прогон вживую: «Перескажи статью по ссылке https://…» → модель должна сразу позвать `web_fetch`, без `web_search`.
- [ ] 9. Прогон «комбо»: «Найди в новостях X и подробно расскажи по первой ссылке» → search → fetch → ответ.
- [ ] 10. Прогон safety-кейсов: `http://localhost:3001`, `http://169.254.169.254`, `file:///etc/passwd`, редирект на localhost, PDF-URL, 500MB-body — все должны давать понятный `error`.
- [ ] 11. Прогон «битая ссылка / 404 / timeout / readability вернула null» → SSE `error`, модель видит ошибку в tool-response и продолжает осмысленно.
- [ ] 12. Прогон cancel'а во время fetch'а — `abort.signal` должен оборвать `fetch()` и stream-reader.
- [ ] 13. Коммит.
