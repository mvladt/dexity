# Iter 1 — Воспроизведение бага удаления чата

## Шаги воспроизведения

1. Авторизоваться (токен `kakako` установлен в `localStorage` через `auth-token`).
2. Создать минимум 1 чат (через API или UI).
3. Открыть любой чат — URL `/chat/:chatId`.
4. Навести курсор на любой чат в сайдбаре — появляется кнопка-корзина (`.g-aikit-history__delete-button`).
5. Нажать кнопку-корзину.

Результат одинаков как для **неактивного** (сценарий 8), так и для **активного** чата (сценарий 9).

---

## Что ожидается

- **Сценарий 8 (удаление неактивного чата):** DELETE-запрос уходит с кодом 200, чат исчезает из сайдбара, активный чат и URL не меняются.
- **Сценарий 9 (удаление активного чата):** DELETE-запрос уходит с кодом 200, чат исчезает из сайдбара, происходит редирект на `/chat`, `activeChat = null`.

---

## Что происходит фактически

Для обоих сценариев (8 и 9):

- DELETE-запрос уходит, но сервер отвечает **400 Bad Request**.
- Чат **остаётся в сайдбаре** — UI не обновляется.
- URL не меняется (нет редиректа для активного чата).
- В консоли браузера выводится ошибка — но никакого уведомления пользователю не показывается (silent fail).

---

## Сетевые запросы

| Метод    | URL                             | Статус | Тело ответа                                                                                                                  |
| -------- | ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `DELETE` | `http://localhost:3001/api/chats/:id` | **400**    | `{"statusCode":400,"code":"FST_ERR_CTP_EMPTY_JSON_BODY","error":"Bad Request","message":"Body cannot be empty when content-type is set to 'application/json'"}` |

**Заголовки запроса (проблемный):**
```
Authorization: Bearer kakako
Content-Type: application/json
```

Запрос не содержит тела (`body`), но заголовок `Content-Type: application/json` присутствует — это и вызывает отказ Fastify.

---

## Console-ошибки

```
[error] Failed to load resource: the server responded with a status of 400 (Bad Request)

[error] HistoryList: failed to delete chat Error: Bad Request
    at handleResponse (http://localhost:5173/src/services/api.ts:17:11)
    at async deleteChat (http://localhost:5173/src/stores/chatStore.ts:24:5)
    at async handleDelete (http://localhost:5173/src/components/ChatSidebar.tsx:38:16)
    at async handleDeleteClick (@gravity-ui/aikit.js:104416:7)
    at async handleDeleteChat (@gravity-ui/aikit.js:104303:7)
```

Также в консоли — многочисленные `[warning]` о `Module "process"/"path"/"fs" has been externalized for browser compatibility`. Это не связано с багом, исходят от зависимостей `@gravity-ui/aikit` в dev-режиме.

---

## Скриншоты

- `e2e/screenshots/s8-01-initial.png` — начальное состояние: оба чата в сайдбаре, активный чат подсвечен.
- `e2e/screenshots/s8-02-after-click.png` — после наведения курсора: появилась кнопка-корзина.
- `e2e/screenshots/s8-04-final.png` — после нажатия кнопки: виден tooltip "Delete", чат **по-прежнему в сайдбаре**, запрос вернул 400.
- `e2e/screenshots/s9-04-final.png` — аналогично для активного чата: tooltip "Delete", чат остался, редиректа нет.
- `e2e/screenshots/capture-03-after-delete.png` — финальное состояние UI после попытки удаления: ничего не изменилось.

---

## Корневая причина

В `client/src/services/api.ts` функция `getHeaders()` **всегда** добавляет `Content-Type: application/json`:

```typescript
// client/src/services/api.ts, строка 7
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
```

Метод `api.delete()` (строки 43–46) отправляет запрос **без тела**, но с этим заголовком:

```typescript
delete: <T>(path: string) =>
  fetch(`${BASE}${path}`, { method: 'DELETE', headers: getHeaders() }).then((r) =>
    handleResponse<T>(r),
  ),
```

Fastify 5 по умолчанию парсит тело запроса при `Content-Type: application/json`. Когда тело пустое — генерирует ошибку `FST_ERR_CTP_EMPTY_JSON_BODY` (HTTP 400). Это стандартное поведение Fastify 5, не баг сервера.

**Затронутые методы:** только `DELETE` (тело не нужно). `GET` также отправляет `Content-Type: application/json`, но Fastify не парсит тело для GET — поэтому GET-запросы работают нормально.

---

## Гипотезы (по приоритету)

1. **Фикс на клиенте (рекомендуется):** не передавать `Content-Type` для запросов без тела. Выделить отдельный `getAuthHeaders()` без `Content-Type`, использовать его в `api.delete()` и `api.get()`.

2. **Фикс на сервере (альтернатива):** добавить опцию Fastify [`addContentTypeParser`](https://fastify.dev/docs/latest/Reference/ContentTypeParser/) или настройку `bodyLimit: 0` / `parseJsonBody: false` для DELETE-маршрутов. Менее чистое решение.
