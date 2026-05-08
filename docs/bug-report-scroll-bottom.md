# Bug Report: Прокрутка document/window сдвигает весь чат-лейаут вверх, оставляя пустую область снизу

**Дата:** 2026-05-08
**Severity:** Medium
**Компонент:** `ChatPage` / `.chat-layout` (CSS-лейаут)

## Описание

При программном или ручном скролле `window` / `document` вниз (например, через `window.scrollTo(0, document.body.scrollHeight)`) весь блок `.chat-layout` физически сдвигается вверх вместе с контентом. Под ним появляется пустая белая область высотой ~342px. При этом поле ввода сообщения и нижняя часть последнего ответа AI оказываются частично скрытыми или выдавленными за видимую границу.

**Корневая причина:** Совместное применение `html, body, #root { height: 100% }` и `.chat-layout { height: 100dvh; overflow: hidden }` создаёт ситуацию, при которой `document.documentElement.scrollHeight` (1422px) превышает `clientHeight` (1080px) на 342px — это разрыв между фиксированной высотой `100dvh` и реальной высотой `100%` родителей. Браузер позволяет `window.scroll` использовать эту разницу, скроля сам `<html>`, несмотря на то что `.chat-layout` имеет `overflow: hidden`.

## Шаги воспроизведения

1. Открыть `http://localhost:5173/chat/1` (чат с несколькими сообщениями)
2. Дождаться полной загрузки страницы
3. В DevTools Console выполнить: `window.scrollTo(0, document.body.scrollHeight)`
4. Наблюдать результат

## Ожидаемое поведение

`window.scrollTo` не должна ничего делать — весь скролл должен происходить только внутри `.chat-messages` (через его собственный `overflow: auto`). Документ не должен скроллиться, `document.documentElement.scrollHeight` должен быть равен `clientHeight` (1080px).

## Фактическое поведение

- `document.documentElement.scrollHeight` = 1422px (на 342px больше viewport)
- После `window.scrollTo(0, document.body.scrollHeight)` → `window.scrollY` = 342
- Весь `.chat-layout` уезжает вверх на 342px (`getBoundingClientRect().top` = -342)
- Нижняя треть экрана (342px) — пустая белая область без содержимого
- Поле ввода сообщения (`Напишите сообщение...`) видно, но чат обрезан сверху — начало переписки скрыто
- Сайдбар со списком чатов также уехал вверх и частично скрыт

## Скриншот

На скриншоте (`scroll-bottom-final.png`) видно:
- Верхняя часть экрана: середина переписки (начало чата скрыто за верхним краем)
- Нижняя часть экрана: поле ввода сообщения упирается примерно в середину экрана по высоте
- Ниже поля ввода — полностью пустая белая область примерно на половину высоты экрана (~500px)
- Сайдбар с навигацией срезан сверху — заголовок "Dexity" и кнопка "+ Новый" не видны

## Дополнительный контекст

```
document.documentElement.scrollHeight: 1422px
document.documentElement.clientHeight: 1080px
window.scrollY после window.scrollTo: 342px (== разница)
.chat-layout: height=100dvh, overflow=hidden, offsetHeight=1080px
.chat-messages: scrollHeight=2066px, clientHeight=972px (скролл правильно работает внутри)
```

**CSS в `client/src/styles.css`:**
```css
html, body, #root {
  height: 100%;   /* ← создаёт основу для разрыва */
}

.chat-layout {
  height: 100dvh; /* ← dvh отличается от % при наличии браузерного UI */
  overflow: hidden;
}
```

**Возможное решение:** добавить `overflow: hidden` на `html` и/или `body`, либо выровнять высоту через единый подход (`100dvh` везде или `100%` везде).
