# Результат: агентский web search через tool calling

План: [agentic-web-search-plan.md](archive/agentic-web-search-plan.md).

## Что сделано

- Backend: round-loop «модель ↔ tool» в `server/src/routes/messages.ts`, `web_search` как function tool, аккумуляция `tool_calls` по `index`, сквозные `callId` / `sourcePosition` через все раунды.
- Backend: расширили `MessageToolData` полями `calls: Source[][]` (per-call группировка) и `parts: PartSnapshot[]` (snapshot interleaving'а thinking/tool в порядке появления, для корректного reload).
- Frontend: `streamStore` переведён на `parts: StreamPart[]` (`thinking | tool | text`) в порядке поступления. `ChatStream` рендерит несколько `ToolMessage`-партов подряд, для сохранённых сообщений использует `toolData.parts` snapshot.
- UI: убран Switch «Web» из composer'а, тогл `webSearch` уехал на `/settings`.

## Известные граничные случаи

- **DeepSeek-V3.2** на сложных запросах активно дробит поиск. `MAX_TOOL_ROUNDS` повышен с 3 до 10 как safety net. На финальном round мы НЕ передаём `tools` (надёжнее, чем `tool_choice:'none'`). У DeepSeek-Reasoner-семейства это всё равно может изредка триггерить DSML в content — нормальное лечение через явный `role:'system'`-сигнал на финальном round записано в `TODO.md`.

## Тесты (playwright-cli, headed)

| #   | Сценарий                                                       | Результат                                                                                |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 11  | DeepSeek V3.2: «новости ИИ + Anthropic, два раздела»           | 3 раунда поиска, interleaving thinking/tool корректный, DSML нет, ответ структурный      |
| 12  | Qwen3 235B: «Сколько будет 2+2?»                               | Ответ «4», `web_search` не вызван                                                        |
| 13  | Qwen3 235B: после #12 в том же чате — «А что нового в мире?»   | Модель в середине диалога сама вызвала `web_search`, источники подгружены                |
| 14  | `webSearchEnabled: false` + «Что нового в новостях?»           | `web_search` не вызван; модель честно ответила «не могу искать»                          |
| 15  | Cancel во время первого `web_search`                           | Stream оборван, assistant-сообщение в БД НЕ записано (только user); composer разблочен   |

## Коммиты

Серия от первого скелета до финальной полировки (см. `git log --oneline -- server/src/routes/messages.ts client/src/stores/streamStore.ts`). Ключевые:

- Базовый round-loop + tool schema
- Сквозные `callId`/`sourcePosition` через все раунды
- `parts: StreamPart[]` для интерливинга thinking/tool в UI
- `MessageToolData.calls` и `MessageToolData.parts` для корректного reload
- `MAX_TOOL_ROUNDS: 3 → 10` (DeepSeek headroom)

## Что НЕ сделано (вынесено в TODO)

- Управление лимитом числа вызовов через сообщение модели, а не через молчаливое снятие `tools` (вылечит остаточный DSML у DeepSeek-Reasoner).
- Учёт `role:'tool'` payload'ов в `ContextIndicator` — после поиска история заметно растёт.
