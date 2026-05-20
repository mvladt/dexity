# План: PromptInput → Full View

## Проблема

Сейчас `PromptInput` используется в `view="simple"`, а селект модели, `Disclaimer` и `ContextIndicator` свёрстаны вручную под полем ввода (`.chat-input-footer`). Они выглядят как «приклеенные» снаружи — потому что Aikit-овский Full View предоставляет под это родные слоты (header/footer), и мы их игнорируем.

Дублирование: одинаковый блок «PromptInput + footer с селектом/disclaimer/индикатором» написан и в `client/src/pages/ChatPage.tsx` (пустое состояние), и в `client/src/components/ChatStream.tsx` (активный чат).

## Что предоставляет `view="full"` (см. `~/Projects/ThirdParty/gravity-ui/aikit/.../PromptInput`)

- `headerProps.topContent` — произвольный ReactNode сверху, внутри рамки инпута
- `headerProps.showContextIndicator` + `contextIndicatorProps` — встроенный `ContextIndicator` в шапке
- `footerProps.bottomContent` — произвольный ReactNode снизу, внутри рамки
- `footerProps.showSettings / showAttachment / showMicrophone` — встроенные иконки слева от Submit-кнопки
- `suggestionsProps`, `topPanel`, `bottomPanel` — опциональные расширения

## План

- [ ] Вынести общий компонент `ChatComposer` в `client/src/components/ChatComposer.tsx` — единое место для PromptInput, селекта модели, индикатора контекста. Props: `onSend`, `status?`, `onCancel?`, `usedTokens?`, `maxContext?`, `placeholder?`.
- [ ] Переключить `ChatComposer` на `view="full"`:
  - [ ] `headerProps.showContextIndicator: true` + `contextIndicatorProps={{ type: 'number', usedContext, maxContext, tooltipContent }}` — индикатор уходит в шапку инпута, справа сверху
  - [ ] `footerProps.bottomContent` — туда кладём `<Select size="s" />` для модели + `<Disclaimer />`. Disclaimer тонкий, селект слева — компактно
- [ ] Удалить из `ChatPage.tsx` и `ChatStream.tsx` ручную вёрстку `.chat-input-footer` (Select, Disclaimer, ContextIndicator) — оставить только `<ChatComposer ... />`
- [ ] Удалить из `client/src/styles.css` правила `.chat-input-footer` и `.chat-input-footer > :nth-child(2)` — больше не нужны. `.chat-input` оставить (внешний контейнер с padding'ом и border-top).
- [ ] В пустом состоянии (без активного чата) `ChatComposer` рендерится без `usedTokens` — `headerProps.showContextIndicator: false`, т.к. контекста ещё нет.
- [ ] Логика `estimateTokens` + `HISTORY_WINDOW` остаётся в `ChatStream.tsx` (там есть `messages`), считается и передаётся в `ChatComposer` как `usedTokens` + `maxContext`.
- [ ] Проверить mobile-first: на узком экране bottomContent (Select + Disclaimer) должен переноситься / сжиматься. Если Disclaimer мешает — скрыть его через `@media (max-width: ...)` или вообще убрать (он информационный, можно перенести в Settings).

## Что НЕ делать в этой итерации

- Не трогаем `EmptyContainer` с suggestions — он остаётся как welcome-state над PromptInput'ом. `suggestionsProps` PromptInput'а — отдельная история.
- Не вводим `topPanel`/`bottomPanel` — нет сценария.
- Не добавляем `showSettings/showAttachment/showMicrophone` — нет соответствующих фич в проекте.

## Тестирование (E2E)

- [ ] Smoke: открыть `/`, проверить что в инпуте сверху виден индикатор контекста (после нескольких сообщений), снизу — селект модели и disclaimer
- [ ] Открыть существующий чат — селект модели и индикатор на месте, индикатор показывает корректное число токенов
- [ ] Сменить модель через селект внутри инпута — значение в сторе обновляется
- [ ] Mobile (375px) — селект и disclaimer не ломают вёрстку, инпут остаётся usable
