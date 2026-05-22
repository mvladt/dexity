# Inline-цитаты в стиле Perplexity — результат

**Дата:** 2026-05-22
**Связанная задача:** `inline-citations-style-task.md`

## Что сделано

Inline-цитаты `[1]`, `[2]` в ответе ассистента заменены на пилюли с доменом источника. Все цитаты одного параграфа сливаются в одну пилюлю в конце параграфа (формат `domain +K`), как в Perplexity. Клик по пилюле открывает URL первого источника группы в новой вкладке.

## Изменённые файлы

- `client/src/utils/citations.ts` — переписан `injectCitationLinks(text, messageId, sources: Source[])`: построчно (`\n`) извлекает все валидные `[N]`, удаляет их из тела строки, добавляет в конец одну пилюлю `[domain +K](#src-<messageId>-<first>)`. Невалидные `[N]` (N > sources.length) остаются как есть. Вынесена `hostOf`.
- `client/src/components/ChatStream.tsx` — передаёт `sources` (не длину) в `injectCitationLinks`; добавлен делегированный click-handler на `.chat-messages`: ловит `a[href^="#src-"]`, парсит `#src-<msgId>-<n>`, открывает `sources[n-1].url` в новой вкладке.
- `client/src/components/SourcesBlock.tsx` — импортирует `hostOf` из `utils/citations`.
- `client/src/components/SourcesBlock.css` — глобальный стиль для пилюли: `inline-flex`, monospace, `font-size: 0.85em`, `padding: 0 5px`, `border-radius: 4px`, `background: --g-color-base-misc-medium`, `color: --g-color-text-primary`. Hover-смена цвета **не делается** (решение пользователя).

## Принятые решения

- **Вариант B** из task (markdown-link + CSS-селектор) — без расширения `TMessageContent`, без кастомных aikit renderer'ов.
- **Текст пилюли** — полный hostname без `www.` (`practicum.yandex.ru`, не «practicum»).
- **Клик = открытие URL в новой вкладке**, не скролл к карточке.
- **Группировка — по абзацу (line)**, а не по подряд идущим. Все цитаты строки → одна пилюля в её конце. Связь «фрагмент → конкретный источник» внутри параграфа теряется (компромисс ради UX, как в Perplexity).
- **Fallback** — невалидные `[N]` (N > sources.length) или нечитаемый URL → текст остаётся без замены.
- **Без hover-стейта** — пилюля не меняет цвет по наведению.

## Проверено

- Светлая и тёмная темы — пилюля контрастна и читаема.
- Клик — `window.open` вызывается с корректным URL источника.
- Стриминг — пилюля рисуется по мере прихода текста и мигрирует к концу растущего параграфа.
- TypeScript: `npx tsc --noEmit` — чисто.

## Открыто на будущее

Если захочется ещё ближе к Perplexity — переключить группировку с «по абзацу» на «по предложению» (split по `.!?` вместо `\n`). Сейчас один большой ответ-абзац даёт одну пилюлю на весь текст, а у Perplexity каждое предложение получает свою пилюлю.
