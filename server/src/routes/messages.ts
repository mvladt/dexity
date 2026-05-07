import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, asc, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chats, messages } from '../db/schema.js';
import { streamChat } from '../services/llm.js';
import { config } from '../config.js';

const chatIdSchema = z.coerce.number().int().positive();
const streamBodySchema = z.object({ content: z.string().min(1).max(10_000) });

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
    return reply.send(rows);
  });

  fastify.post('/api/chats/:chatId/messages/stream', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });
    const chatId = idResult.data;

    const bodyResult = streamBodySchema.safeParse(request.body);
    if (!bodyResult.success) return reply.status(400).send({ error: 'Invalid request' });
    const userContent = bodyResult.data.content;

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

    // Build LLM context
    const llmMessages = [
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

    // Keep-alive ping every 15s
    const pingInterval = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);

    let fullContent = '';

    try {
      const stream = await streamChat(llmMessages);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullContent += delta;
          writeSSE(reply, { type: 'delta', delta });
        }
      }
    } catch (err: unknown) {
      clearInterval(pingInterval);
      request.log.error({ err }, 'Yandex API error');

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

      writeSSE(reply, { type: 'error', code, message });
      reply.raw.end();
      return;
    }

    clearInterval(pingInterval);

    // Save assistant message
    const [assistantMsg] = await db
      .insert(messages)
      .values({ chatId, role: 'assistant', content: fullContent })
      .returning();

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

    reply.raw.end();
  });
};

export default messagesRoute;
