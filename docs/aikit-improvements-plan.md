# План улучшений UI на базе `@gravity-ui/aikit`

Сейчас задействована примерно треть возможностей `aikit`. Ниже — список улучшений с привязкой к компонентам, сгруппированный по сложности.

Источники: `client/src/pages/ChatPage.tsx`, `client/src/components/{ChatSidebar,ChatStream}.tsx`, `ThirdParty/gravity-ui/aikit/src/components/**`.

## Quick wins (≤ полчаса каждый)

- [x] 1. **Действия на сообщениях** — `BaseMessage`/`MessageList` поддерживают `actions` (`copy`, `edit`, `delete`, `regenerate`) с `showActionsOnHover`. Минимум: `copy` на ассистенте, `edit`/`delete` на юзере. Сейчас действий нет вообще. _Сделано: copy на ассистенте + showActionsOnHover._
- [x] 2. **Stop / Cancel стриминга** — `SubmitButton` переключается send ↔ cancel; `PromptInput` принимает `onCancel`. Прокинуть в `streamStore.cancel()`. _Сделано: `streamStore.cancel()` через `AbortController`; на бэке `request.raw.close` аборт upstream OpenAI-стрима, чтобы не платить за токены после cancel. Убрал `disabled={streaming}` — иначе aikit форсит `submitButtonState='disabled'`._
- [x] 3. **Группировка чатов по дате** — заменить `groupBy="none"` на `groupBy="date"` в `ChatSidebar` → автоматом «Сегодня / Вчера / N дней назад».
- [x] 4. **Поиск по чатам** — `searchable` у `HistoryList`. Без него при 50+ чатах сайдбар бесполезен.
- [x] 5. **`Disclaimer` под инпутом** — «AI может ошибаться, проверяйте важное».
- [x] 6. **Timestamp на сообщениях** — `showTimestamp` у `BaseMessage`.

_Выкинута: «Регенерация последнего ответа». YandexGPT детерминированная (низкая температура), разброс между прогонами минимальный — фича превращается в «галочку как у всех» без реального UX-выигрыша. Перекрывается будущим #19 (edit + rerun)._

## Средние улучшения

- [x] 7. **`PromptInput view="full"`** вместо `simple` — открывает header/footer: `ContextIndicator`, settings, attachment, microphone. _Сделано: `view="full"` подключён в `ChatComposer.tsx`. `headerProps.topContent` — `ContextIndicator`, `footerProps.bottomContent` — селект модели + переключатель Web. Изначально планировали отложить до #16, но фактически footer наполнился содержимым раньше — за счёт #11 (выбор модели) и #15 (Web-тогл)._
- [x] 8. **`ContextIndicator` (% контекста)** — бэк льёт всю историю в `messages[]` каждый раз (CLAUDE.md). Рано или поздно упрётся в лимит токенов. Показывать процент окна. _Сделано: оценка `chars / 3` (BPE YandexGPT по кириллице), окно `last 20` (как на бэке). MAX_CONTEXT — динамический, зависит от выбранной модели (#11). Размещён в отдельном ряду под инпутом, рядом с Disclaimer._
- [ ] 9. **`FeedbackForm` + `RatingBlock`** — thumbs up/down + причина + комментарий. Логировать в SQLite в отдельную таблицу.
- [ ] 10. **`ThinkingMessage`** — collapsible «думаю…» до первого токена стрима (TTFB Yandex 2-3 сек, UI кажется висящим).
- [x] 11. **Выбор модели в footer’е** — селект `yandexgpt-lite` / `yandexgpt` / `yandexgpt-32k` / `qwen3-235b-a22b-fp8`, передавать в `/api/stream`. Сейчас — хардкод через `MODEL_ID`. _Сделано: Zustand-стор `settingsStore` + Select из `@gravity-ui/uikit` + проброс `model` в `/api/stream`. Список моделей — статический в `client/src/models.ts`, валидируется при rehydrate. MODEL_ID в .env остаётся fallback'ом, если фронт ничего не пришлёт. Изначально включал `llama`/`llama-lite`, но Yandex Cloud для этого `FOLDER_ID` их не отдаёт (`400 Failed to get model`) — выкинул._
- [x] 12. **Системный промпт (глобальный)** — `settingsStore.systemPrompt` (persist в localStorage `dexity-settings`), пробрасывается в body `/messages/stream`, бэк инжектит первым `{ role: 'system', content }` в `llmMessages`. Редактируется на странице `/settings` (TextArea + автосейв с debounce 500 ms). _Сделано не per-chat (как изначально предлагал план), а глобально — как в Perplexity. Применяется ко всем чатам, включая существующие. Без миграции БД._
- [ ] 13. **Экспорт чата в Markdown** — кнопка в шапке/контекстном меню, генерация `.md` на фронте из `messages`.
- [x] 14. **`History` как отдельная страница** — переехала из сайдбара в `/history` (полноценная страница с шапкой, поиском, группировкой, удалением). Левый сайдбар приложения теперь — nav rail (Новый чат / История / Настройки), как в Perplexity. _В плане изначально стояло «popup» — заменили на страницу, потому что суммарно потребовалась перестройка навигации, а не альтернативный виджет._

## «Крутые фичи» — Dexity ближе к Perplexity

- [ ] 15. **Web search + цитаты** — главная фишка Perplexity. Yandex Search API / SerpAPI → снипы в системный промпт → модель ставит `[1]`-маркеры → рендер через `InlineCitation` + блок «Sources». aikit готов: `ToolMessage`, `ToolStatus`, `InlineCitation`, `createMessageRendererRegistry()`. Самая сильная фича из списка.
- [ ] 16. **Прикрепление файлов** — `AttachmentPicker` + `FileUploadDialog`. Бэк: парсить `.txt/.md/.pdf` (`pdf-parse`), инжектить в prompt. Yandex текстовая, но через файлы получится квази-multimodal.
- [ ] 17. **Branching диалога (forks)** — кнопка «ответвить от этого сообщения». В БД у `chats` добавить `parent_chat_id` + `branch_from_message_id`. UI: ветки как отдельные чаты в сайдбаре.
- [ ] 18. **Edit message + автоматический rerun** — отредактировал свой вопрос → удаляются все последующие сообщения → перегенерация. Стандарт ChatGPT.
- [ ] 19. **Динамические follow-up suggestions** — в системном промпте просить модель генерить 2-3 follow-up вопроса, рендерить через `Suggestions` под последним ответом. Визитка Perplexity.
- [ ] 20. **Подсветка кода + copy-button на блоках** — `MarkdownRenderer` на `highlight.js`. Проверить, что подсветка включена и кнопка копирования рендерится.
- [ ] 21. **Поиск по содержимому чатов** — SQLite FTS5-таблица для `messages.content`. Попап/экран «Найти в истории». Резко повышает ценность долгой переписки.
- [ ] 22. **Закрепление чатов** — `pinned: boolean` у `chats`, отдельная группа «Закреплённые» вверху сайдбара.

## Рекомендуемый порядок

1. Quick wins (**1, 2, 3, 4, 5, 6**) — закрыто.
2. **12** (system prompt) — закрыто.
3. **15** (web search) — без него Dexity «ещё один чат с LLM», с ним — реальный клон Perplexity.
