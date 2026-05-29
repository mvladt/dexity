# План: агентский web search через tool calling

Переезд с «синхронный поиск перед LLM по тогглу пользователя» на «модель сама решает, нужен ли поиск, через function calling».

## Контекст

- Yandex AI Studio Chat Completions API поддерживает `tools` параметр для **всех** моделей в нашем списке (проверено разведочным скриптом 2026-05-27).
- Это закрывает пункт #15 из `aikit-improvements-plan.md` (Web search) в «правильном» формате — как у Perplexity/ChatGPT, без ручного тоггла.

## Архитектура

### Backend: цикл «модель ↔ tool»

`server/src/routes/messages.ts`, поток внутри POST `/api/chats/:chatId/messages/stream`:

```
1. Собрать llmMessages (system + history + user)
2. Round-loop (max 3 итерации):
   a. streamChat(llmMessages, tools=[web_search])
   b. Параллельно стримить delta.content → SSE 'delta' клиенту
   c. Аккумулировать delta.tool_calls[index] (склейка кусков arguments по index)
   d. После закрытия стрима:
      - Если tool_calls пуст → break (финальный ответ получен)
      - Иначе:
        * Для каждого tool_call:
          - SSE 'tool' { name:'web', status:'loading', callId }
          - webSearch(args.query) → sources
          - SSE 'tool' { name:'web', status:'success', sources, callId }
          - Добавить в llmMessages: { role:'assistant', tool_calls: [...] }
                                    + { role:'tool', tool_call_id, content: JSON.stringify(sources) }
        * Continue → следующая итерация
3. Сохранить assistant message с финальным content + накопленными sources в toolData
```

**Защита от циклов**: `MAX_TOOL_ROUNDS = 3`. Если модель упёрлась — форсим финальный ответ через `tool_choice: 'none'` на последней итерации.

**Tools schema**:

```ts
const tools = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Ищет актуальную информацию в интернете. Используй для свежих событий, цен, новостей, фактов после твоего обучения.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Поисковый запрос на русском" },
        },
        required: ["query"],
      },
    },
  },
];
```

### SSE-протокол: что меняется

Сейчас:

- `tool` событие шлётся **один раз** до `delta`-стрима.

Будет:

- `tool` события могут приходить **между** раундами стрима, **несколько раз**.
- Каждое `tool` событие получает `callId` (индекс из tool_calls), чтобы фронт мог их различать.
- Тип события (`loading` / `success` / `error`) остаётся как сейчас.

### Frontend

`streamStore.ts`:

- Заменить `partialTool: ToolState | null` на `partialTools: Map<callId, ToolState>` (или массив).
- `toolData.sources` — union всех `sources` из всех успешных tool_calls (по позиции — перенумеровать сквозно).

`ChatStream.tsx`:

- Рендерить несколько `ToolMessage` партов подряд — по одному на каждый раунд.
- Парт-структура одного assistant-сообщения: `[tool1, tool2?, thinking?, text]`.

`ChatComposer.tsx`:

- **Убрать** тогл «Web» из footer'а.
- Поведение «вкл/выкл» теперь определяется системно: `tools` всегда передаётся (модель решает).
- В `settingsStore` — оставить существующий флаг `webSearchEnabled` (по умолчанию `true`). Имя не меняем: это per-tool флаг, при будущем добавлении других tools у каждого свой `xxxEnabled`. Если `false` — backend не передаёт `tools` в запросе. UI для этого флага — на странице `/settings`, не в composer'е.

## Шаги реализации

### Backend

- [x] 1. `server/src/services/llm.ts` — добавить параметр `tools` в `streamChat`, пробросить в SDK.
- [x] 2. `server/src/routes/messages.ts` — обернуть стрим в round-loop, аккумулировать tool_calls, исполнять `webSearch`, пушить промежуточные SSE-события.
- [x] 3. `shared/types.ts` — расширить SSE-протокол: `tool` событие получает `callId: number`.
- [x] 4. Tools schema — описать `web_search` функцию рядом с `webSearch()` сервисом (один файл — `server/src/services/search.ts`).
- [x] 5. Удалить `buildSearchPromptBlock` и старую ветку «синхронный поиск по тогглу» из routes/messages.ts.

### Frontend

- [x] 6. `client/src/stores/streamStore.ts` — `partialTool` → `partialTools` (массив по callId). Парсить SSE с учётом нового поля.
- [x] 7. `client/src/components/ChatStream.tsx` — рендерить несколько `ToolMessage` партов.
- [x] 8. `client/src/components/ChatComposer.tsx` — убрать `<Switch>` «Web» из footer'а.
- [x] 9. `client/src/stores/settingsStore.ts` — оставить `webSearchEnabled` как есть (имя не меняем), перенести UI в `/settings`.
- [x] 10. `shared/types.ts` (client side) — обновить тип `MessageToolData.sources` (если меняется структура — стоит подумать о хранении нескольких «раундов» источников, или склеивать в один список — склеивать проще).

### Проверка

- [x] 11. Прогон вживую: «Что нового в новостях?» → модель должна вызвать `web_search` сама.
- [x] 12. Прогон: «Сколько будет 2+2?» → модель НЕ должна вызывать `web_search` (auto-режим).
- [x] 13. Прогон с длинной историей: модель решает искать в середине диалога.
- [x] 14. Прогон с `webSearchEnabled: false` → tools не передаются, модель отвечает без поиска.
- [x] 15. Прогон c cancel'ом во время tool execution → `abort.signal` корректно отменяет и LLM, и Yandex Search.

## Открытые вопросы / риски

1. **Латентность**. В простом кейсе «нужен поиск» теперь: LLM-roundtrip 1 (~1с) → search (~2с) → LLM-roundtrip 2 (~стрим). Раньше: search (~2с) → LLM-roundtrip 1. То есть +1 LLM-roundtrip. Без вариантов — это плата за «агентность».

2. **Цена ×2** на запросах с поиском (два вызова LLM). Не критично для личного использования.

3. **`reasoning_content` от Qwen3/GPT-OSS** во **всех раундах**. Сейчас мы стримим `thinking_delta` в один thinking-парт. С несколькими раундами — нужно решить: склеивать всё в один thinking-блок или иметь по одному на раунд. Минималистично — склеивать.

4. **Token budget**. После tool-результата история растёт (добавился `role: tool` с JSON источников). `ContextIndicator` это не учитывает. Не критично для v1, отметить как известное ограничение.

5. **Модель может зациклиться** — звать поиск снова и снова. `MAX_TOOL_ROUNDS = 3` + переключение на `tool_choice: 'none'` на последней итерации как защита.

6. **YandexGPT-серия** в разведке исправно генерировала tool_calls, но качество запросов и решение «когда искать» может быть слабее, чем у Qwen3. Можно протестировать в #11–13 и при необходимости подкрутить description.

## Что закрывается этим планом

- Пункт #15 из `aikit-improvements-plan.md` целиком.

## Что НЕ делается

- Другие tools (calc, file reader, и т.д.) — текущая архитектура их легко добавит, но в v1 только `web_search`.
- Toggle `auto` / `forced` / `off` в UI — для минимализма только `enabled` / `disabled` в settings.
