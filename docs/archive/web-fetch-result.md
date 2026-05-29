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

- **Лейблы плашек** — «Read» → «Fetch», «Web Search» → «Search» (имена tool-функций `web_search`/`web_fetch` для LLM не менялись). Иконка fetch: `SquareArticle`.
- **Нудж в описании tool'а** — модель вызывала `web_fetch` всего раз; описание усилено: явно поощряем читать несколько страниц (в т.ч. параллельно).
- **Плашка Fetch = заголовок-ссылка, без разворота** — на success показываем кликабельную ссылку на прочитанную страницу (title + host). Это единственное место, где виден URL прочитанной страницы (в нумерованные источники `web_search` фетчи не попадают), поэтому ссылка = провенанс.
- **Багфикс: упавшие фетчи исчезали из истории** — `partsLog` писался только в success-ветке. Теперь на ошибке пишем `{type:'fetch', url, error:true}` → при reload упавшее чтение остаётся. `PartSnapshot.fetch`: `title` опционален, добавлен `error?`.

  ⚠️ Тот же изъян остаётся у ошибок `web_search` (на ошибке в `partsLog` ничего не пишется) — не трогал, вне текущего запроса.

### Отклонённые итерации

- **LLM-резюме на разворот** — пробовали отдельный дешёвый вызов `aliceai-llm-flash` для компактного резюме страницы на разворот плашки. Откатили: резюме дублирует то, что уже есть в ответе модели, плюс лишний вызов и латентность на каждую страницу. Вместо разворота — кликабельная ссылка (см. выше).
