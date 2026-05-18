# План улучшений UI на базе `@gravity-ui/aikit`

Сейчас задействована примерно треть возможностей `aikit`. Ниже — список улучшений с привязкой к компонентам, сгруппированный по сложности.

Источники: `client/src/pages/ChatPage.tsx`, `client/src/components/{ChatSidebar,ChatStream}.tsx`, `ThirdParty/gravity-ui/aikit/src/components/**`.

## Quick wins (≤ полчаса каждый)

- [ ] 1. **Действия на сообщениях** — `BaseMessage`/`MessageList` поддерживают `actions` (`copy`, `edit`, `delete`, `regenerate`) с `showActionsOnHover`. Минимум: `copy` на ассистенте, `edit`/`delete` на юзере. Сейчас действий нет вообще.
- [ ] 2. **Stop / Cancel стриминга** — `SubmitButton` переключается send ↔ cancel; `PromptInput` принимает `onCancel`. Прокинуть в `streamStore.cancel()`.
- [ ] 3. **Регенерация последнего ответа** — `action.regenerate` на ассистенте → `startStream` с теми же messages, минус последний.
- [x] 4. **Группировка чатов по дате** — заменить `groupBy="none"` на `groupBy="date"` в `ChatSidebar` → автоматом «Сегодня / Вчера / N дней назад».
- [x] 5. **Поиск по чатам** — `searchable` у `HistoryList`. Без него при 50+ чатах сайдбар бесполезен.
- [x] 6. **`Disclaimer` под инпутом** — «AI может ошибаться, проверяйте важное».
- [ ] 7. **Timestamp на сообщениях** — `showTimestamp` у `BaseMessage`.

## Средние улучшения

- [ ] 8. **`PromptInput view="full"`** вместо `simple` — открывает header/footer: `ContextIndicator`, settings, attachment, microphone.
- [ ] 9. **`ContextIndicator` (% контекста)** — бэк льёт всю историю в `messages[]` каждый раз (CLAUDE.md). Рано или поздно упрётся в лимит токенов. Показывать процент окна.
- [ ] 10. **`FeedbackForm` + `RatingBlock`** — thumbs up/down + причина + комментарий. Логировать в SQLite в отдельную таблицу.
- [ ] 11. **`ThinkingMessage`** — collapsible «думаю…» до первого токена стрима (TTFB Yandex 2-3 сек, UI кажется висящим).
- [ ] 12. **Выбор модели в footer’е** — селект `yandexgpt-lite` / `yandexgpt` / `yandexgpt-32k` / `llama`, передавать в `/api/stream`. Сейчас — хардкод через `MODEL_ID`.
- [ ] 13. **Системный промпт / роль на чат** — поле `system_prompt` у `chats` + редактор в шапке. Бэк подмешивает в начало `messages[]`. Дёшево и резко повышает полезность.
- [ ] 14. **Экспорт чата в Markdown** — кнопка в шапке/контекстном меню, генерация `.md` на фронте из `messages`.
- [ ] 15. **`History` (popup) как альтернатива сайдбару** — шаблон с поиском, группировкой, пагинацией. На мобильных удобнее, чем сайдбар.

## «Крутые фичи» — Dexity ближе к Perplexity

- [ ] 16. **Web search + цитаты** — главная фишка Perplexity. Yandex Search API / SerpAPI → снипы в системный промпт → модель ставит `[1]`-маркеры → рендер через `InlineCitation` + блок «Sources». aikit готов: `ToolMessage`, `ToolStatus`, `InlineCitation`, `createMessageRendererRegistry()`. Самая сильная фича из списка.
- [ ] 17. **Прикрепление файлов** — `AttachmentPicker` + `FileUploadDialog`. Бэк: парсить `.txt/.md/.pdf` (`pdf-parse`), инжектить в prompt. Yandex текстовая, но через файлы получится квази-multimodal.
- [ ] 18. **Branching диалога (forks)** — кнопка «ответвить от этого сообщения». В БД у `chats` добавить `parent_chat_id` + `branch_from_message_id`. UI: ветки как отдельные чаты в сайдбаре.
- [ ] 19. **Edit message + автоматический rerun** — отредактировал свой вопрос → удаляются все последующие сообщения → перегенерация. Стандарт ChatGPT.
- [ ] 20. **Динамические follow-up suggestions** — в системном промпте просить модель генерить 2-3 follow-up вопроса, рендерить через `Suggestions` под последним ответом. Визитка Perplexity.
- [ ] 21. **Подсветка кода + copy-button на блоках** — `MarkdownRenderer` на `highlight.js`. Проверить, что подсветка включена и кнопка копирования рендерится.
- [ ] 22. **Поиск по содержимому чатов** — SQLite FTS5-таблица для `messages.content`. Попап/экран «Найти в истории». Резко повышает ценность долгой переписки.
- [ ] 23. **Закрепление чатов** — `pinned: boolean` у `chats`, отдельная группа «Закреплённые» вверху сайдбара.

## Рекомендуемый порядок

1. Сначала пп. **1, 2, 3, 4, 5** — quick wins, час-два суммарно, UX сразу прыгнет.
2. Потом **13** (system prompt) и **9** (`ContextIndicator`) — фундамент для серьёзной работы с моделью.
3. Дальше — **16** (web search). Без него Dexity — «ещё один чат с LLM», с ним — реальный клон Perplexity.
