# Результат — Tool `web_fetch`

План: `web-fetch-task.md` (в этой же папке). Реализовано оркестрацией двух суб-агентов (бэк + фронт) с последующим ревью и живыми прогонами.

## Что сделано

### Backend

- **`server/src/services/fetch.ts`** (новый):
  - `webFetchTool: ChatCompletionTool` со схемой `{ url: string }`.
  - `fetchUrl(url, signal)`: SSRF-блок → ручной цикл редиректов (max 5, валидация каждого hop) → фильтр `Content-Type` (`text/html`/`application/xhtml+xml`) → ранний отсев по `Content-Length` → стриминговое чтение с лимитом 2 MB → `linkedom` + `@mozilla/readability` → обрезка до 15k символов. Timeout 10с через `AbortSignal.timeout` + `AbortSignal.any` с внешним signal.
  - SSRF — нативно через `node:net.isIP`, без зависимостей. IPv4 (маски), IPv6 (ручной парсер с `::` и IPv4-mapped), `localhost`, fail-safe на нераспарсенном адресе.
- **`server/src/routes/messages.ts`**:
  - `tools` → `[webSearchTool, webFetchTool]` (при `webSearchEnabled && !isFinalRound`).
  - Диспетчер tool_call'ов переписан с последовательного `for` на параллельный `Promise.allSettled`. `loading`-SSE уходят пачкой в порядке `callId`, `success/error` — по мере резолва.
  - Дедуп: `Map<normalizedUrl, Promise<FetchResult>>` на жизнь хендлера. Soft cap `MAX_FETCHES_PER_RESPONSE = 20`.
  - Фикс: `toolData` теперь сохраняется при любой tool-активности (`partsLog.some(p => p.type==='tool'||p.type==='fetch')`), а не только при наличии источников — иначе fetch-only ответы теряли парты при reload.

### Shared

- `shared/types.ts`: `SSEEvent.tool.name: 'web' | 'fetch'` + поля `url?`/`title?`. `PartSnapshot` + вариант `{ type:'fetch'; url; title }` (полный контент в БД не пишем).

### Frontend

- `client/src/services/stream.ts`: `onTool` теперь принимает весь объект `tool`.
- `client/src/stores/streamStore.ts`: `ToolState` с дискриминантом `kind: 'web' | 'fetch'`.
- `client/src/components/ChatStream.tsx`: `buildFetchPart` — `ToolMessage` с лейблом `Read`, иконкой `FileText`, host в заголовке и title в теле. Рендер fetch-партов из снапшота при reload. Фикс `hasTool` для fetch-only ответов.

### Прочее

- `TODO.md`: пункт про DNS rebinding (осознанно вне скоупа v1).

## Найденный баг (критичный)

В `isBlockedIPv4` операция `ip & mask` для подсетей со старшим битом ≥ `0x80` (`192.168/16`, `172.16/12`, `169.254/16`) давала знаковое **отрицательное** 32-битное число, а сетевые литералы — положительные unsigned → сравнение `===` проваливалось. На реальном VPS это означало бы доступ к cloud metadata (`169.254.169.254`) и приватной сети. В песочнице маскировалось сетевым таймаутом. Фикс — `(ip & mask) >>> 0`.

## Верификация

- **Safety** — все приватные диапазоны (включая IPv4-mapped IPv6), file/ftp/gopher, PDF (Content-Type), битый URL дают понятный `error`. ✓
- **Live fetch** — «перескажи статью https://ru.wikipedia.org/wiki/Node.js»: модель сразу вызвала `web_fetch`, SSE `loading→success` с `title`, ответ 1048 символов реального контента, `toolData.parts` = `[{type:'fetch', url, title}]`. ✓
- **Graceful** — несуществующая страница: readability распарсил «страница не существует», модель корректно сообщила. ✓
- **Typecheck** — server + client чисто.

## Не покрыто живьём (низкий риск)

- Combo search→fetch (item 9) и cancel во время fetch (item 12) — код общий с рабочим `web_search`, проверено по коду.

## Доработки по фидбэку (после ревью в UI)

- **Лейбл/иконка** — плашка fetch: «Read» → «Web Fetch», иконка `SquareArticle` (вместо `FileText`).
- **Нудж в описании tool'а** — модель вызывала `web_fetch` всего раз; описание усилено: явно поощряем читать несколько страниц (в т.ч. параллельно).
- **LLM-резюме на разворот** — после загрузки отдельный дешёвый вызов `aliceai-llm-flash` (`summarizePage` в `llm.ts`) делает компактное резюме (2–5 предложений, всегда на русском). Хранится в `PartSnapshot.fetch.summary`, показывается на разворот плашки. Дедуп fetch+summary в одном кэш-промисе. Основная модель по-прежнему получает полный текст.
- **Багфикс: упавшие фетчи исчезали из истории** — `partsLog` писался только в success-ветке. Теперь на ошибке пишем `{type:'fetch', url, error:true}` → при reload упавшее чтение остаётся. `PartSnapshot.fetch`: `title` стал опциональным, добавлены `summary?`, `error?`.

  ⚠️ Тот же изъян остаётся у ошибок `web_search` (на ошибке в `partsLog` ничего не пишется) — не трогал, вне текущего запроса.

- Визуальный рендер плашки в браузере — фронт typecheck-clean, но глазами не смотрел. Рекомендуется глянуть в UI.
