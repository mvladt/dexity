# Отчёт: предупреждения консоли браузера

Дата: 2026-05-07  
URL: http://localhost:5173  
Источник: Playwright, автоматический сбор консольных сообщений

---

## Группа 1 — Node.js-модули в @gravity-ui/aikit (20 warnings)

Vite экстернализирует Node.js-модули, на которые опирается `@gravity-ui/aikit`, так как они недоступны в браузере.

**Модули:** `path`, `fs`, `url`, `process`, `source-map-js`

**Пример:**

```
Module "path" has been externalized for browser compatibility.
Cannot access "path.isAbsolute" in client code.
```

**Источник:** `@gravity-ui/aikit.js` (внутренний код библиотеки, не наш)

**Затронутые API:**

- `process.platform`
- `path.isAbsolute`, `path.resolve`, `path.dirname`, `path.join`, `path.relative`, `path.sep`
- `fs.existsSync`, `fs.readFileSync`
- `url.fileURLToPath`, `url.pathToFileURL`
- `source-map-js.SourceMapConsumer`, `source-map-js.SourceMapGenerator`

**Возможное решение:** добавить заглушки через `define` или `resolve.alias` в `vite.config.ts`.

---

## Группа 2 — React Router v7 future flags (2 warnings)

```
⚠️ React Router Future Flag Warning: React Router will begin wrapping state
updates in React.startTransition in v7. You can use the v7_startTransition
future flag to opt-in early.

⚠️ React Router Future Flag Warning: Relative route resolution within Splat
routes is changing in v7. You can use the v7_relativeSplatPath future flag
to opt-in early.
```

**Решение:** добавить `future` флаги при создании роутера:

```ts
future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
```

---

## Группа 3 — favicon.ico не найден (2 errors)

```
Failed to load resource: the server responded with a status of 404 (Not Found)
@ http://localhost:5173/favicon.ico
```

**Решение:** добавить `favicon.ico` (или `.svg`) в `client/public/`.

---

## Группа 4 — autocomplete на input (1 verbose)

```
[DOM] Input elements should have autocomplete attributes (suggested: "new-password")
```

**Источник:** страница `/login`, поле ввода пароля/токена.

**Решение:** добавить атрибут `autocomplete` на `<input>` в форме логина.

---

## Приоритеты

| #   | Группа                        | Сложность | Приоритет |
| --- | ----------------------------- | --------- | --------- |
| 1   | React Router future flags     | низкая    | высокий   |
| 2   | favicon.ico 404               | низкая    | высокий   |
| 3   | autocomplete на input         | низкая    | средний   |
| 4   | @gravity-ui/aikit Node-модули | средняя   | низкий    |
