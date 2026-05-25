# Bug: сервер падает при удалении чата во время активного стриминга

**Дата:** 2026-05-19
**Severity:** High — процесс падает, in-flight стрим теряется. `tsx watch` поднимает обратно, но в проде (без watch) Fastify ушёл бы.
**Найдено:** playwright-tester во время верификации коммита `617938a`.

---

## Симптом

Если пользователь удаляет чат (или уходит со страницы так, что соединение закрывается до конца стрима) пока ассистент ещё печатает ответ, на бэке после завершения LLM-стрима происходит:

```
SqliteError: FOREIGN KEY constraint failed
    at Database.prepare (better-sqlite3)
    at db.insert(messages).values({ chatId, role: 'assistant', content: fullContent })
        — server/src/routes/messages.ts:143
```

Дальше Fastify пытается вернуть 500-ответ клиенту, но SSE-ответ уже открыт (заголовки отправлены через `reply.raw.writeHead` на строке 80), поэтому:

```
Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
```

Это валит процесс целиком. В dev (`tsx watch`) процесс автоматически перезапускается, поэтому баг не сразу заметен, но в проде без watch Fastify уйдёт.

## Воспроизведение

1. Открыть `/chat`, отправить любое сообщение.
2. Пока ассистент стримит — открыть второй таб, удалить этот чат через UI (или `DELETE /api/chats/:id`).
3. Подождать, пока LLM закончит отдавать поток. Сервер крашится.

Также воспроизводится навигацией со страницы во время стрима + удалением чата (тестер ловил оба сценария).

## Причина

`server/src/routes/messages.ts`, строки 142–162 — после успешного итерирования по `streamChat` код делает три записи в БД подряд:

```ts
const [assistantMsg] = await db
  .insert(messages)
  .values({ chatId, role: 'assistant', content: fullContent })
  .returning();

await db.update(chats).set({ updatedAt: ... }).where(eq(chats.id, chatId));

if (userMessagesBefore === 0) {
  await db.update(chats).set({ title: chatTitle, ... }).where(eq(chats.id, chatId));
}
```

Между `streamChat` (десятки секунд при длинном ответе) и моментом записи никто не проверяет, что `chatId` всё ещё существует. Если за это время `DELETE /api/chats/:id` удалил чат, `INSERT messages(chat_id=...)` падает по `FOREIGN KEY`.

Дополнительно: исключение возникает **после** `reply.raw.writeHead(200, ...)`, поэтому глобальный error handler Fastify пытается отправить 500 на уже открытый сокет → `ERR_HTTP_HEADERS_SENT`.

## Ожидаемое поведение

- Если чат удалён во время стрима — assistant-сообщение не сохраняется, процесс не падает, ничего не пишется в SQLite.
- SSE-соединение либо корректно закрывается (`reply.raw.end()`), либо клиент уже не слушает (не важно).
- Никаких necaught-exception на бэке.

## Предлагаемое решение

Минимальное: обернуть «послестримовую» секцию (строки 142–172) в `try/catch`, ловить ошибки и просто бросать без `writeSSE`:

```ts
try {
  // Проверяем что чат ещё существует — иначе клиент уже не ждёт ответа
  const [stillExists] = await db.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId));
  if (!stillExists) {
    reply.raw.end();
    return;
  }

  const [assistantMsg] = await db.insert(messages).values(...).returning();
  // ...остальное...
  writeSSE(reply, { type: 'done', ... });
  reply.raw.end();
} catch (err) {
  request.log.warn({ err, chatId }, 'Stream post-processing failed (chat likely deleted)');
  // Заголовки уже отправлены — просто закрываем сокет, ничего не пишем
  try { reply.raw.end(); } catch {}
}
```

Альтернативно: подписаться на `request.raw.on('close', ...)` (уже подписан для `abort` upstream, см. строка 95) и выставлять флаг `clientGone`, по которому пропускать запись в БД. Это чище, но требует чуть больше кода.

## Замечание о `request.raw.on('close')`

В роуте уже есть:

```ts
request.raw.on("close", () => abort.abort());
```

Этот обработчик аборает upstream OpenAI-стрим при отключении клиента. Можно расширить: добавить флаг `clientDisconnected = true` и проверять его перед `db.insert`. Тогда оба сценария (клиент ушёл / чат удалён) обрабатываются единообразно.

## Затронутые файлы

- `server/src/routes/messages.ts` — строки 142–172 (логика после стрима).

## Тест

Перед фиксом — воспроизвести вручную или e2e-тестом (создать чат → отправить длинное сообщение → во время стрима DELETE → дождаться окончания стрима → проверить, что процесс жив через `pgrep`).

После фикса — тот же сценарий не валит процесс, в логах warn-сообщение про «chat likely deleted».
