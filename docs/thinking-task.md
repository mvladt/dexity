# Thinking — reasoning-блок в ответе ассистента

Источник дизайна: `dexity-gravity-ui/project/Dexity Prototype.html`, артборд **«02 · Стриминг: Thinking + Web Search»**.
Базовый компонент: `ThinkingMessage` из `@gravity-ui/aikit` (уже в `dependencies`, версия `~1.17`).

## Цель

При стриминге ответа от моделей с reasoning (Qwen3, DeepSeek V3.2, GPT-OSS) показывать **процесс размышления отдельным блоком** над итоговым ответом. Блок — нативный `<ThinkingMessage>` из aikit: вертикальная полоса слева, кнопка «Thinking»/«Thought» с шевроном, контент в complementary-цвете.

## Что в aikit (визуальная спека)

```
ThinkingMessage
├── Кнопка size="s"  ["Thinking" / "Thought"]  ⌄
├── Loader xs        (во время status="thinking")
└── content (string | string[])  ← рендерится как Markdown или plain
```

Props, которые используем:

- `content: string | string[]` — текст мыслей
- `status: 'thinking' | 'thought'` — стрим / закончил
- `format: 'markdown'` — мысли могут содержать форматирование
- `defaultExpanded: true` — раскрыт во время стриминга, чтобы видно было процесс
- `enabledCopy: true` — после `thought` появляется кнопка copy

## Поток данных

```
Yandex Cloud SSE chunk
  delta.reasoning_content  ──►  SSE {type:'thinking_delta', delta}  ──►  streamStore.partialThinking
  delta.content            ──►  SSE {type:'delta', delta}           ──►  streamStore.partialContent
```

Чанк от OpenAI-совместимого API для reasoning-моделей имеет нестандартное поле `delta.reasoning_content` (то же поле использует DeepSeek и Qwen в OpenAI-режиме). Тип в SDK не описан — берём через `as unknown as { reasoning_content?: string }`.

## Что меняется

### 1. `shared/types.ts`

```ts
export type SSEEvent =
  | { type: 'thinking_delta'; delta: string }   // ←  новое
  | { type: 'delta'; delta: string }
  | { type: 'done'; fullContent: string; assistantMessageId: number; chatTitle?: string }
  | { type: 'error'; code: 'auth' | 'quota' | 'server'; message: string };
```

### 2. Бэк — `server/src/routes/messages.ts`

В цикле `for await (const chunk of stream)`:

```ts
const delta = chunk.choices[0]?.delta ?? {};
const reasoning = (delta as { reasoning_content?: string }).reasoning_content;
if (reasoning) writeSSE(reply, { type: 'thinking_delta', delta: reasoning });
if (delta.content) {
  fullContent += delta.content;
  writeSSE(reply, { type: 'delta', delta: delta.content });
}
```

Бэк **не сохраняет** thinking в БД (см. открытый вопрос №2).

### 3. Фронт — `client/src/services/stream.ts`

В callbacks — `onThinkingDelta?: (delta: string) => void`. В цикле — обработать новый эвент.

### 4. Фронт — `client/src/stores/streamStore.ts`

Добавить:
- `partialThinking: string`
- сбрасывать в `cancel` и в начале `startStream`
- в `onThinkingDelta` дописывать
- в `onDone` — обнулять (`thought` появится в финальной отрисовке через completed-message, но мы её **не показываем** после сохранения)

### 5. Фронт — `client/src/components/ChatStream.tsx`

`MessageList` из aikit не умеет рендерить `ThinkingMessage` для стримингового сообщения. Поэтому **во время стриминга** вынимаем последнее сообщение из `MessageList` и рендерим его кастомно:

```
<MessageList messages={completed} ... />
{streaming && (
  <div className="assistant-streaming">
    {partialThinking && (
      <ThinkingMessage
        content={partialThinking}
        status="thinking"
        format="markdown"
      />
    )}
    <BaseMessage role="assistant" content={partialContent} />
  </div>
)}
```

(Точная разметка — на этапе кодинга; ключевое: `ThinkingMessage` отдельным блоком **над** содержимым ответа.)

## Открытые вопросы

1. **Какие модели включают reasoning?** По умолчанию Qwen3, DeepSeek V3.2, GPT-OSS включают. YandexGPT — нет. Нужно ли явно отключать thinking для определённых моделей, или просто полагаемся на то, что бэк от API не получит `reasoning_content`? Рекомендация: полагаемся (минимализм).
2. **Хранить thinking в БД?** Сейчас не храним — после reload истории thinking-блок не появится, останется только финальный ответ. Это поведение Claude.ai и Perplexity. Альтернатива — добавить колонку `thinking TEXT` в `messages` и поле в `Message`-тип. **Рекомендация:** не хранить.
3. **Реакция, когда reasoning пришёл, а content — нет (ошибка / отмена в середине thinking).** Сейчас в `done` пойдёт пустой `fullContent`, и сохранится пустое assistant-сообщение. Возможно стоит не сохранять пустой ответ. Отдельная мелочь — можно сделать после.
4. **Тестирование без живой модели.** Бэк-юнит-теста на стрим у нас нет; проверять буду вживую с Qwen3.

## План

- [x] 1. Расширить `SSEEvent` в `shared/types.ts` (тип `thinking_delta`)
- [x] 2. Бэк — читать `delta.reasoning_content` и стримить `thinking_delta`
- [x] 3. `streamStore` — `partialThinking` + callback
- [x] 4. `stream.ts` — обработать новый эвент
- [x] 5. `ChatStream.tsx` — рендерить `<ThinkingMessage>` во время стриминга над контентом — реализовано через нативный `messageRendererRegistry` aikit (parts массив с `{type:'thinking'}`), а не отдельным блоком над `MessageList`. Чище.
- [x] 6. Проверить вживую: ✅ Qwen3.6 (3.6) и DeepSeek V3.2 — блок появляется. ❌ Qwen3 235B и Alice AI — не возвращают `reasoning_content` по умолчанию. Зафиксировано в `docs/thinking-models-task.md`.
- [ ] 7. **Хранение в БД** — добавить колонку `thinking` в `messages`, сохранять, рендерить свёрнутый блок в истории.

## Что НЕ делаем сейчас

- WebSearch (следующий этап — после thinking)
- Хранение thinking в БД
- Кастомизация цветов/типографики `ThinkingMessage` — пользуемся дефолтами aikit
