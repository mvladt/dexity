# model-selector e2e — починить после перехода на PromptInput `view="full"`

После перевода `PromptInput` с `view="simple"` на `view="full"` (через общий `ChatComposer`) тесты `e2e/tests/model-selector.spec.ts` падают: 8 из 12. Селекторы и часть утверждений завязаны на старую разметку.

## Что сломалось

- **`.chat-input-footer`** — этого класса больше нет. Сейчас футер живёт внутри `PromptInput` через `footerProps.bottomContent` и имеет класс `.chat-composer-footer` (см. `client/src/components/ChatComposer.tsx`).
- **`[data-qa="submit-button-simple"]`** — больше не подходит, теперь рендерится `submit-button-full` (или другой data-qa из `view="full"` aikit). Проверить актуальное имя в исходниках `@gravity-ui/aikit`.
- **Disclaimer** — был удалён из футера (см. соответствующий коммит). Соответствующие проверки `getByText(/AI может ошибаться/i)` и `footer.getByText(/AI може/i)` надо снести.

## Что починить

- [ ] `Footer row is visible under PromptInput…` — заменить `.chat-input-footer` на `.chat-composer-footer`, выпилить ожидание Disclaimer
- [ ] `Submit button uses simple view…` — переписать под актуальный data-qa `view="full"` (вероятно `submit-button-full`)
- [ ] `Footer row in active chat has ContextIndicator on the right` — `.chat-input-footer` → `.chat-composer-footer`. **Важно:** ContextIndicator теперь живёт в `headerProps.topContent`, а не в футере — селектор и описание теста подправить
- [ ] `ContextIndicator % changes when model maxContext changes` — поменять `submit-button-simple` на актуальный data-qa, проверить, что кнопка отмены берётся корректно
- [ ] `ContextIndicator tooltip contains maxContext…` — проверить, что hover по индикатору всё ещё триггерит tooltip (индикатор переехал в header)
- [ ] `POST /api/chats/:id/messages/stream includes "model"` — обновить data-qa submit-кнопки
- [ ] `Cancel button appears during stream and stops it` — тот же data-qa
- [ ] `Mobile responsive (375x667)` — `.chat-input-footer` → `.chat-composer-footer`. Disclaimer удалён, проверку на текст «AI може…» убрать. Проверить, что футер всё ещё помещается в 375px

## Заметки

- Хелперы `getSelectedModelLabel`, `selectModel`, `waitForStreamingToEnd` опираются на `.g-select-control` — он остался, так что хелперы переписывать не нужно.
- После правок прогнать полностью `model-selector.spec.ts`, плюс соседний `prompt-input-fullview.spec.ts` — убедиться, что ничего не задеваем.
