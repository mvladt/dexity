# Текущий контекст

## PromptInput → Full View (в работе, не закоммичено)

План: `docs/prompt-input-fullview-plan.md`.

Перевели `@gravity-ui/aikit` `PromptInput` с `view="simple"` на `view="full"` — селект модели, Disclaimer и ContextIndicator теперь внутри рамки инпута (через `headerProps`/`footerProps`), а не свёрстаны снаружи.

**Изменено:**
- `client/src/components/ChatComposer.tsx` — новый общий компонент
- `client/src/components/ChatStream.tsx`, `client/src/pages/ChatPage.tsx` — рендерят `<ChatComposer />`
- `client/src/styles.css` — удалён `.chat-input-footer`, добавлены `.chat-composer-footer`/`.chat-composer-disclaimer` + media `<=480px` скрывает Disclaimer

**Тесты:** новый `e2e/tests/prompt-input-fullview.spec.ts` — 6/6 проходят.

**На ревью / TODO:**
- Возможная двойная граница у `.chat-input` (его `border-top` + рамка PromptInput full view) — глянуть глазами
- `e2e/tests/model-selector.spec.ts` — 8/12 падают, тесты завязаны на старый `view="simple"`. Чинить отдельно
- Disclaimer на узких экранах скрывается media query'ом. Возможно, его место в Settings

## SSE crash fix

Бэк падал из-за необработанной ошибки в `POST /api/chats/:id/messages/stream`: при удалении чата параллельно со стримом `insert assistant message` ловил FK constraint, Fastify пытался отдать 500-ку поверх уже отправленного SSE → `ERR_HTTP_HEADERS_SENT` uncaught → процесс умирал.

Фикс в `server/src/routes/messages.ts`: после `writeHead` вызывается `reply.hijack()`, пост-стримовый блок обёрнут в `try/catch/finally` с гарантированным `clearInterval` и `reply.raw.end()`.
