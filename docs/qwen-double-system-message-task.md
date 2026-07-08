# Баг: двойное system-сообщение ломает Qwen3.6 35B

## Симптом

В чате с моделью **Qwen3.6 35B** (`qwen3.6-35b-a3b`) и непустым системным
промптом (Settings → «Системный промпт») любой запрос падает с ошибкой:

```
Failed to generate completions: Failed to apply prompt template: invalid
operation: System message must be at the beginning. (in default:85)
```

(вариант `in tool_use:85` — то же самое, но когда включён web search и в
контекст добавляются tool-сообщения).

Обнаружено на баг-репорте пользователя (`chat/383`, ответа ассистента нет
вообще — застряло на первом сообщении).

## Причина

`server/src/routes/messages.ts:201-207` собирает `llmMessages` так:

```ts
const llmMessages: ChatCompletionMessageParam[] = [
  { role: 'system' as const, content: buildBaseSystem(timeZone) },
  ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
  ...history.map(...),
  ...
];
```

Если у пользователя задан кастомный `systemPrompt` — в массив уходят **два**
отдельных сообщения с `role: 'system'` подряд (индексы 0 и 1). Chat-шаблон
Qwen3.6 35B (Jinja-темплейт на стороне Yandex Cloud AI Studio) требует ровно
одно system-сообщение и именно в начале — второе он трактует как нарушение
и роняет весь запрос.

## Проверено (A/B на localhost, напрямую через `/api/chats/:id/messages/stream`)

| Модель | 1 system-сообщение (без `systemPrompt`) | 2 system-сообщения (`systemPrompt` задан) |
|---|---|---|
| Qwen3.6 35B (`qwen3.6-35b-a3b`) | OK | **падает** (`invalid operation: System message must be at the beginning`) |
| Qwen3 235B (`qwen3-235b-a22b-fp8`) | — | OK |

Значит баг не во всём семействе Qwen, а именно в шаблоне Qwen3.6 35B —
модели с прицелом на неё сделать дефолтной (см. ниже).

## Почему не заметили раньше

Дефолтная модель по умолчанию — DeepSeek V4 Flash (`client/src/models.ts:20`),
её шаблон спокойно принимает несколько system-сообщений подряд. Баг не
проявлялся, пока модель не переключили на Qwen3.6 35B вручную.

## Фикс (не применён, только описан — ждёт вашего ОК)

Слить `buildBaseSystem()` и `systemPrompt` в одно system-сообщение вместо
двух:

```ts
const systemContent = [buildBaseSystem(timeZone), systemPrompt].filter(Boolean).join('\n\n');

const llmMessages: ChatCompletionMessageParam[] = [
  { role: 'system' as const, content: systemContent },
  ...history.map(...),
  ...
];
```

Это ровно та структура (1 system-сообщение), на которой прошёл A/B-тест
выше — фикс не гипотеза, а подтверждённое решение.

## Блокирует

Смену дефолтной модели на Qwen3.6 35B (`client/src/models.ts:20`,
`DEFAULT_MODEL_ID`) — пользователь попросил об этом отдельно, но
переключать дефолт на модель с известным багом смысла нет. Сначала фикс,
потом смена дефолта.

## План

- [x] Слить два system-сообщения в одно в `server/src/routes/messages.ts` (см. фикс выше)
- [x] Проверить руками на Qwen3.6 35B с непустым `systemPrompt` — фикс подтверждён A/B-тестом через curl
- [x] Прогнать e2e (`cd e2e && npm test`) — все 34 теста зелёные
- [x] Сменить `DEFAULT_MODEL_ID` в `client/src/models.ts` на `qwen3.6-35b-a3b`
- [x] Поправить e2e-тесты, завязанные на дефолт (`model-selector.spec.ts`, `prompt-input-fullview.spec.ts`) — вместо строковых литералов теперь импортируют `getModel(DEFAULT_MODEL_ID).label` из `client/src/models.ts`, чтобы не разъезжаться с кодом при следующей смене дефолта

## Не проверено (опционально на будущее)

- [ ] Путь с web search включён — tool-сообщения (`role: 'assistant', tool_calls: ...` + `role: 'tool'`) добавляются в `llmMessages` уже после первого system-сообщения, схема та же (1 system в начале), но живьём с реальным Yandex Cloud не гонялось
