import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, asc, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chats, messages, sources } from '../db/schema.js';
import { streamChat } from '../services/llm.js';
import { webSearch } from '../services/search.js';
import type { Source, Message } from '../types.js';
import { config } from '../config.js';

const chatIdSchema = z.coerce.number().int().positive();
const streamBodySchema = z.object({
  content: z.string().min(1).max(10_000),
  model: z.string().optional(),
  systemPrompt: z.string().max(4000).optional(),
  webSearch: z.boolean().optional(),
});

function buildSearchPromptBlock(srcs: Source[]): string {
  const list = srcs
    .map((s) => `[${s.position}] ${s.title} (${s.url})\n${s.snippet}`)
    .join('\n\n');
  return [
    'Используй источники ниже для ответа. Ставь маркеры цитат [1], [2]… сразу после факта.',
    'Не выдумывай факты, которых нет в источниках. Если данных недостаточно — скажи об этом.',
    '',
    'Источники:',
    list,
  ].join('\n');
}

const NO_RESULTS_NOTE =
  'Поиск не дал результатов или временно недоступен. Отвечай по своим знаниям.';

function writeSSE(reply: { raw: { write: (s: string) => void } }, data: object) {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildTitle(content: string): string {
  const text = content.trim().replace(/\s+/g, ' ');
  if (text.length <= 50) return text;
  const cut = text.lastIndexOf(' ', 50);
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, 50)) + '…';
}

const messagesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/chats/:chatId/messages', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });

    const [chat] = await db.select().from(chats).where(eq(chats.id, idResult.data));
    if (!chat) return reply.status(404).send({ error: 'Chat not found' });

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, idResult.data))
      .orderBy(asc(messages.createdAt));

    const ids = rows.map((r) => r.id);
    const srcRows = ids.length
      ? await db.select().from(sources).where(inArray(sources.messageId, ids))
      : [];

    const byMessage = new Map<number, Source[]>();
    for (const s of srcRows) {
      const arr = byMessage.get(s.messageId) ?? [];
      arr.push({ position: s.position, title: s.title, url: s.url, snippet: s.snippet });
      byMessage.set(s.messageId, arr);
    }
    for (const arr of byMessage.values()) {
      arr.sort((a, b) => a.position - b.position);
    }

    const result: Message[] = rows.map((r) => {
      const arr = byMessage.get(r.id);
      return arr && arr.length > 0 ? { ...r, sources: arr } : r;
    });
    return reply.send(result);
  });

  fastify.post('/api/chats/:chatId/messages/stream', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });
    const chatId = idResult.data;

    const bodyResult = streamBodySchema.safeParse(request.body);
    if (!bodyResult.success) return reply.status(400).send({ error: 'Invalid request' });
    const userContent = bodyResult.data.content;
    const modelOverride = bodyResult.data.model;
    const userSystemPrompt = bodyResult.data.systemPrompt?.trim() || undefined;
    const webSearchEnabled = bodyResult.data.webSearch === true;

    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
    if (!chat) return reply.status(404).send({ error: 'Chat not found' });

    // Load last 20 messages before inserting user message
    let history = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    history = history.reverse();

    // Drop orphaned assistant message at start of window
    if (history.length > 0 && history[0].role === 'assistant') {
      history = history.slice(1);
    }

    const userMessagesBefore = history.filter((m) => m.role === 'user').length;

    // Insert user message
    const [userMsg] = await db
      .insert(messages)
      .values({ chatId, role: 'user', content: userContent })
      .returning();

    // Abort upstream when client disconnects (stop paying Yandex tokens on cancel)
    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());

    // Web search before SSE — so sources event can be the first frame
    let foundSources: Source[] = [];
    if (webSearchEnabled) {
      try {
        foundSources = await webSearch(userContent, abort.signal);
      } catch (err) {
        request.log.warn({ err }, 'web search failed');
        foundSources = [];
      }
    }

    // Build LLM context
    let effectiveSystemPrompt: string | undefined = userSystemPrompt;
    if (webSearchEnabled) {
      const block = foundSources.length > 0
        ? buildSearchPromptBlock(foundSources)
        : NO_RESULTS_NOTE;
      effectiveSystemPrompt = effectiveSystemPrompt
        ? `${effectiveSystemPrompt}\n\n${block}`
        : block;
    }

    const llmMessages = [
      ...(effectiveSystemPrompt ? [{ role: 'system' as const, content: effectiveSystemPrompt }] : []),
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userContent },
    ];

    // Open SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': config.CORS_ORIGIN ?? '*',
    });
    // Fastify won't touch reply anymore — any thrown error must not reach its error handler
    // (it would try to writeHead a 500 over an already-streaming SSE response).
    reply.hijack();

    // Send sources first (even if empty) so UI can render the panel skeleton
    if (webSearchEnabled) {
      writeSSE(reply, { type: 'sources', sources: foundSources });
    }

    // Keep-alive ping every 15s
    const pingInterval = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);

    let fullContent = '';

    try {
      const stream = await streamChat(llmMessages, abort.signal, modelOverride);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullContent += delta;
          writeSSE(reply, { type: 'delta', delta });
        }
      }

      // Save assistant message
      const [assistantMsg] = await db
        .insert(messages)
        .values({ chatId, role: 'assistant', content: fullContent })
        .returning();

      if (foundSources.length > 0) {
        await db.insert(sources).values(
          foundSources.map((s) => ({
            messageId: assistantMsg.id,
            position: s.position,
            title: s.title,
            url: s.url,
            snippet: s.snippet,
          })),
        );
      }

      // Update chat updated_at
      await db
        .update(chats)
        .set({ updatedAt: sql`(datetime('now'))` })
        .where(eq(chats.id, chatId));

      // Auto-title on first user message
      let chatTitle: string | undefined;
      if (userMessagesBefore === 0) {
        chatTitle = buildTitle(userContent);
        await db
          .update(chats)
          .set({ title: chatTitle, updatedAt: sql`(datetime('now'))` })
          .where(eq(chats.id, chatId));
      }

      writeSSE(reply, {
        type: 'done',
        fullContent,
        assistantMessageId: assistantMsg.id,
        ...(chatTitle ? { chatTitle } : {}),
      });
    } catch (err: unknown) {
      if (abort.signal.aborted) {
        // Client cancelled — socket already closed, just bail
        return;
      }

      request.log.error({ err }, 'Stream failed');

      const status = (err as { status?: number })?.status;
      let code: 'auth' | 'quota' | 'server' = 'server';
      let message = 'Сервис недоступен, попробуйте позже';

      if (status === 401 || status === 403) {
        code = 'auth';
        message = 'Неверный API-ключ или нет доступа к модели';
      } else if (status === 429) {
        code = 'quota';
        message = 'Лимит запросов исчерпан';
      }

      try {
        writeSSE(reply, { type: 'error', code, message });
      } catch {
        // socket already gone
      }
    } finally {
      clearInterval(pingInterval);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
};

export default messagesRoute;
