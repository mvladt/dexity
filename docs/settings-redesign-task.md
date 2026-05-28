# Редизайн страницы настроек — task

Перерисовать `client/src/pages/SettingsPage.tsx` под макет из Claude Design (`dexity-gravity-ui-handoff.tar.gz` → `project/pages.jsx` → `SettingsPage`).

## Цель

Сейчас страница плоская: один заголовок + два блока без визуального разделения (Web Search + System Prompt). В макете — структурированные секции с описаниями, row-формат для тогглов, segmented control для темы.

## Контекст

- Источник: артефакт Claude Design, выгружен в `~/Downloads/dexity-gravity-ui-handoff.tar.gz`, распакован в `/tmp/dexity-design/dexity-gravity-ui/`.
- Все `dx-settings-*` CSS-классы из бандла — это ручная реплика стилей. Берём только структуру/layout, рисуем своими классами `settings-*` через токены `@gravity-ui/uikit`.

## Что в макете

Четыре секции:

1. **Модель** — Select дефолтной модели + textarea системного промпта со счётчиком символов.
2. **Интерфейс** — Web Search, Стриминг ответов, Цитаты-маркеры, Тема (segmented Light/Dark/System).
3. **Yandex Cloud** — три row: `YC_API_KEY`, `YC_SEARCH_API_KEY`, `FOLDER_ID` — маскированные значения, кнопка «Изменить» рядом.
4. **Опасная зона** — кнопка «Удалить все чаты» (danger).

В шапке — заголовок «Настройки» + бейдж «Сохранено» (positive, появляется после изменения, скрывается через 1.5 с).

## Объём правки

### Реальная функциональность

- [x] Секция «Модель» — Select по умолчанию (синхронизирован с `settingsStore.model`, временно дублирует выбор в `ChatComposer` — см. TODO).
- [x] Секция «Модель» — Системный промпт (уже есть в `settingsStore.systemPrompt`), добавить счётчик `len / 4000`.
- [x] Секция «Интерфейс» — Web Search (есть в `settingsStore.webSearch`).
- [x] Секция «Интерфейс» — Тема (расширить `ThemeSwitcher` → segmented Light/Dark/System, использовать `prefers-color-scheme`).
- [x] Бейдж «Сохранено» — общий индикатор для всей страницы (срабатывает на любое изменение).

### Заглушки (UI без логики)

- [ ] Стриминг ответов — локальный `useState`, без сохранения. Бэк всегда отдаёт SSE.
- [ ] Цитаты-маркеры — локальный `useState`. У нас всегда показываются.
- [ ] Yandex Cloud секция — захардкоженные маскированные строки (`AQVN••••CK4` и т.п.), кнопки «Изменить» с пустым `onClick`. Реально ключи лежат в `server/.env` и через UI не меняются.
- [ ] «Удалить все чаты» — `confirm()` + пустой `onClick`, бэк-эндпоинта нет.

### Сопутствующие изменения

- [x] Убрать `ThemeSwitcher` из `AppLayout.tsx` (футер nav-rail). Тема теперь живёт в Settings.
- [x] Удалить `client/src/components/ThemeSwitcher.tsx`.
- [x] В `App.tsx` заменить заглушку `theme === 'system' ? 'light'` на реальное `matchMedia('(prefers-color-scheme: dark)')`-отслеживание.
- [x] CSS: переписать секцию `Settings page` в `styles.css` — `.settings-section`, `.settings-row`, `.settings-segmented`.

## Что специально НЕ делаем (в TODO)

- Разделение «модель по умолчанию для новых чатов» vs «модель текущего чата» — сейчас одно поле `settingsStore.model`, в макете оно же. Когда понадобится — см. TODO.
- Бэк-эндпоинт `DELETE /api/chats` для «удалить все чаты» — см. TODO.

## Источники

- Макет: `/tmp/dexity-design/dexity-gravity-ui/project/pages.jsx`, функция `SettingsPage`.
- Цвета/радиусы/spacing — из токенов Gravity UI (`@gravity-ui/uikit`).
- Чат-транскрипт с дизайнером: `/tmp/dexity-design/dexity-gravity-ui/chats/chat1.md` (про секции и фичи).
