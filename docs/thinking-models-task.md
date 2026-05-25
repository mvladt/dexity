# Thinking-режим для моделей без default thinking

Связанная фича: `docs/thinking-task.md`.

## Проблема

Некоторые модели в Yandex Cloud не возвращают `delta.reasoning_content` по умолчанию — отвечают сразу контентом. В нашем UI блок «Thinking» не появляется.

### Что подтверждено через `RAW_CHUNK`-лог

| Модель                  | reasoning_content по умолчанию |
|-------------------------|--------------------------------|
| `qwen3.6-35b-a3b`       | ✅ есть                         |
| `deepseek-v32`          | ✅ есть                         |
| `qwen3-235b-a22b-fp8`   | ❌ нет (одно из состояний пользователя)  |
| `aliceai-llm`           | ❌ нет                          |
| `yandexgpt`, `yandexgpt-lite`, `yandexgpt-32k` | ❌ нет (модели без reasoning) |

(`gpt-oss-*` — не проверяли.)

## Что выяснить

- [ ] **Qwen3 235B (`qwen3-235b-a22b-fp8`).** Точно умеет thinking (есть варианты `*-thinking-*` от самого Qwen). Варианты включения:
  - либо в YC есть отдельный ID типа `qwen3-235b-a22b-thinking-fp8` → подправить `client/src/models.ts`
  - либо нужен флаг `chat_template_kwargs: { enable_thinking: true }` (или `extra_body`) в запросе → подправить `server/src/services/llm.ts`
- [ ] **Alice AI (`aliceai-llm`, `aliceai-llm-flash`).** Неясно, есть ли у модели thinking-режим вообще. Проверить документацию YC / AI Studio:
  - если умеет → включить тем же путём, что для Qwen3
  - если не умеет → задокументировать факт и оставить как есть (блок просто не появляется — это корректно)
- [ ] **GPT-OSS (`gpt-oss-120b`, `gpt-oss-20b`).** Не проверены. Прогнать тестовый запрос с reasoning-вопросом, посмотреть `RAW_CHUNK`.

## Как проверить (recipe)

1. Временно вернуть debug-лог в `server/src/routes/messages.ts` (5 первых чанков):
   ```ts
   let chunkIdx = 0;
   for await (const chunk of stream) {
     if (chunkIdx < 5) {
       request.log.info({ model: modelOverride, chunkIdx, chunk }, 'RAW_CHUNK');
       chunkIdx++;
     }
     ...
   }
   ```
2. Задать reasoning-вопрос («Сколько букв "р" в слове X?») каждой модели.
3. Глянуть `grep RAW_CHUNK logs/server.log` — есть ли `delta.reasoning_content`.
4. Если нет — попробовать модель с флагом:
   ```ts
   client.chat.completions.create(
     { model, messages, stream: true,
       ...({ chat_template_kwargs: { enable_thinking: true } } as Record<string, unknown>),
     },
     { signal },
   );
   ```
5. Повторить, посмотреть, появилось ли `reasoning_content`.

## Когда делаем

После основной миграции БД для thinking (см. `docs/thinking-task.md`, пункт «хранение в БД»).
