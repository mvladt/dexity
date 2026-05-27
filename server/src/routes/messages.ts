import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, asc, desc, sql } from 'drizzle-orm';
import type { MessageToolData, PartSnapshot, Source } from '../../../shared/types.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { db } from '../db/client.js';
import { chats, messages } from '../db/schema.js';
import { streamChat } from '../services/llm.js';
import { webSearch, webSearchTool } from '../services/search.js';
import { config } from '../config.js';

// Сколько раундов модели разрешено вызывать tools. Последний раунд — без
// tools, чтобы выжать финальный текст. Эмпирически: DeepSeek-V3.2 любит
// много искать (3-х было мало — на финальном round без tools она лезет
// в content DSML-формат tool_call'а вместо обычного текста).
const MAX_TOOL_ROUNDS = 10;

const chatIdSchema = z.coerce.number().int().positive();
const streamBodySchema = z.object({
  content: z.string().min(1).max(10_000),
  model: z.string().optional(),
  systemPrompt: z.string().max(4000).optional(),
  webSearch: z.boolean().optional(),
});

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
    return reply.send(
      rows.map((r) => ({
        ...r,
        toolData: r.toolData ? (JSON.parse(r.toolData) as MessageToolData) : null,
      })),
    );
  });

  fastify.post('/api/chats/:chatId/messages/stream', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });
    const chatId = idResult.data;

    const bodyResult = streamBodySchema.safeParse(request.body);
    if (!bodyResult.success) return reply.status(400).send({ error: 'Invalid request' });
    const userContent = bodyResult.data.content;
    const modelOverride = bodyResult.data.model;
    const systemPrompt = bodyResult.data.systemPrompt?.trim() || undefined;
    const webSearchEnabled = bodyResult.data.webSearch === true;

    const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
    if (!chat) return reply.status(404).send({ error: 'Chat not found' });

    let history = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    history = history.reverse();

    if (history.length > 0 && history[0].role === 'assistant') {
      history = history.slice(1);
    }

    const userMessagesBefore = history.filter((m) => m.role === 'user').length;

    const [userMsg] = await db
      .insert(messages)
      .values({ chatId, role: 'user', content: userContent })
      .returning();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': config.CORS_ORIGIN ?? '*',
    });
    reply.hijack();

    const pingInterval = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);

    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());

    let fullContent = '';
    let fullThinking = '';
    const allSources: Source[] = [];
    const callsSources: Source[][] = [];
    const partsLog: PartSnapshot[] = [];

    // Сквозные счётчики через все раунды
    let sourcePosition = 1;
    let callIdSeq = 0;

    try {
      const llmMessages: ChatCompletionMessageParam[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: userContent },
      ];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (abort.signal.aborted) return;

        // На последнем раунде вообще не передаём tools — это надёжнее,
        // чем tool_choice:'none'. Некоторые reasoning-модели (DeepSeek V3.2)
        // в режиме 'none' эмулируют tool_call в обычном content через свой
        // внутренний DSML-формат, который OpenAI-обёртка не парсит.
        const isFinalRound = round === MAX_TOOL_ROUNDS - 1;
        const tools = webSearchEnabled && !isFinalRound ? [webSearchTool] : undefined;

        let roundThinking = '';

        const stream = await streamChat(llmMessages, abort.signal, modelOverride, tools);

        // Аккумулятор tool_calls по index (куски arguments приходят по частям)
        type AccToolCall = {
          index: number;
          id: string;
          name: string;
          arguments: string;
        };
        const accToolCalls: Map<number, AccToolCall> = new Map();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta ?? {};

          const reasoning = (delta as { reasoning_content?: string }).reasoning_content;
          if (reasoning) {
            fullThinking += reasoning;
            roundThinking += reasoning;
            writeSSE(reply, { type: 'thinking_delta', delta: reasoning });
          }

          if (delta.content) {
            fullContent += delta.content;
            writeSSE(reply, { type: 'delta', delta: delta.content });
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!accToolCalls.has(idx)) {
                accToolCalls.set(idx, { index: idx, id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
              }
              const acc = accToolCalls.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
          }
        }

        if (abort.signal.aborted) return;

        const toolCallsList = [...accToolCalls.values()];
        if (toolCallsList.length === 0) {
          // Финальный ответ получен. Если в этом раунде модель ещё «думала»
          // перед текстом — сохраним этот thinking как последний парт.
          if (roundThinking) partsLog.push({ type: 'thinking', content: roundThinking });
          break;
        }

        // Перед группой tool_call'ов одного раунда — снапшот thinking'а
        // этого раунда (если был), чтобы при reload видеть interleaving.
        if (roundThinking) partsLog.push({ type: 'thinking', content: roundThinking });

        // Выполняем каждый tool_call и собираем tool-messages для следующего раунда
        const toolMessages: ChatCompletionMessageParam[] = [];

        for (const tc of toolCallsList) {
          const callId = callIdSeq++;

          let parsedArgs: { query?: string } = {};
          try {
            parsedArgs = JSON.parse(tc.arguments);
          } catch {
            toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'invalid arguments' }) });
            continue;
          }

          if (tc.name !== 'web_search') {
            toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'unknown tool' }) });
            continue;
          }

          const query = parsedArgs.query ?? '';
          writeSSE(reply, { type: 'tool', tool: { name: 'web', status: 'loading', callId } });

          try {
            const rawSources = await webSearch(query, abort.signal);
            if (abort.signal.aborted) return;

            const sources: Source[] = rawSources.map((s) => ({ ...s, position: sourcePosition++ }));
            allSources.push(...sources);
            callsSources.push(sources);
            partsLog.push({ type: 'tool', sources });

            writeSSE(reply, { type: 'tool', tool: { name: 'web', status: 'success', sources, callId } });
            toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(sources) });
          } catch (err) {
            if (abort.signal.aborted) return;
            request.log.warn({ err }, 'Web search failed');
            writeSSE(reply, { type: 'tool', tool: { name: 'web', status: 'error', callId } });
            toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'search failed' }) });
          }
        }

        // Добавляем assistant-сообщение с tool_calls и ответы tool'ов в историю
        llmMessages.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCallsList.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
        llmMessages.push(...toolMessages);
      }

      const toolData: MessageToolData | null =
        allSources.length > 0
          ? { sources: allSources, calls: callsSources, parts: partsLog }
          : null;

      const [assistantMsg] = await db
        .insert(messages)
        .values({
          chatId,
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking || null,
          toolData: toolData ? JSON.stringify(toolData) : null,
        })
        .returning();

      await db
        .update(chats)
        .set({ updatedAt: sql`(datetime('now'))` })
        .where(eq(chats.id, chatId));

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
        ...(fullThinking ? { fullThinking } : {}),
        ...(toolData ? { fullTool: toolData } : {}),
        ...(chatTitle ? { chatTitle } : {}),
      });
    } catch (err: unknown) {
      if (abort.signal.aborted) {
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
