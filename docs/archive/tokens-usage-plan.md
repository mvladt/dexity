# План: реальные вход/исходящие токены (usage)

## Зачем

Сейчас индикатор контекста показывает **грубую оценку** (`text.length / 3`) — не настоящие токены. Нужно показывать **реальные** значения от LLM:

- **под каждым ответом ассистента** — сколько стоил конкретный ответ (`↑prompt ↓completion`);
- **итог по чату** — суммарный расход, всегда на виду.

Источник правды — поле `usage` в ответе OpenAI-совместимого API Yandex. В стриме оно приходит только при `stream_options: { include_usage: true }` — сейчас флаг не выставлен, поэтому реальные цифры до нас не доезжают.

Делаем **строго на компонентах AIKit 2.x** (`assistantExtraInfo` + `message.metadata` + `ContextItem`), без кастомного UI.

## Бэкенд

- [x] `server/src/services/llm.ts` — добавить `stream_options: { include_usage: true }` в `streamChat`.
- [x] `server/src/routes/messages.ts` — в цикле стрима копить `promptTokens`/`completionTokens` из `chunk.usage` (суммировать по всем tool-раундам — это полная стоимость ответа). Сохранять их в `persistAssistant`. Добавить `usage` в SSE-событие `done`.
- [x] `server/src/db/schema.ts` — колонки `promptTokens`, `completionTokens` (integer, nullable).
- [x] `server/src/db/migrate.ts` — добавить в `CREATE TABLE` + `ALTER` для существующих БД (паттерн как у `thinking`/`tool_data`).

## Общие типы

- [x] `shared/types.ts` — `Message`: `promptTokens?`, `completionTokens?`. Событие `done`: опциональное `usage: { promptTokens; completionTokens }`.

## Фронтенд

- [x] `client/src/services/stream.ts` — пробросить `usage` в `onDone`.
- [x] `client/src/stores/streamStore.ts` — положить `usage` в добавляемое сообщение.
- [x] `client/src/components/ChatStream.tsx`:
  - `toAikitMessage` → класть `metadata: { promptTokens, completionTokens }` в assistant-сообщения;
  - компонент `TokenInfo` (на `ContextItem`) → отдать в `MessageList` через `assistantExtraInfo`;
  - посчитать сумму по чату.
- [x] `client/src/components/ChatComposer.tsx` — чип-итог (`ContextItem`) рядом с `ContextIndicator` в `topContent`.

## Нюансы

- `usage` приходит в финальном чанке раунда (с пустым `choices`) — обычный цикл его не ломает (`choices[0]?.delta ?? {}`).
- Частичный/прерванный ответ может прийти без `usage` — поля остаются `null`, `TokenInfo` ничего не рисует.
- Оценочный `ContextIndicator` (прогноз «сколько займёт») оставляем — это другой по смыслу показатель, чем фактический расход.

## Проверка

- `tsc --noEmit` в `server` и `client`.
- Smoke в браузере (Playwright `--headed`): отправить сообщение → под ответом виден `↑N ↓M`, в шапке композера — суммарный чип; после reload значения сохраняются (из БД).
