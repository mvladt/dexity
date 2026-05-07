import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chats } from '../db/schema.js';

const chatIdSchema = z.coerce.number().int().positive();
const createBodySchema = z.object({ title: z.string().min(1).max(200).optional() });
const renameBodySchema = z.object({ title: z.string().min(1).max(200) });

const chatsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/chats', async (_request, reply) => {
    const rows = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, 1))
      .orderBy(desc(chats.updatedAt));
    return reply.send(rows);
  });

  fastify.post('/api/chats', async (request, reply) => {
    const result = createBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request' });
    }
    const title = result.data.title ?? 'Новый чат';
    const [chat] = await db.insert(chats).values({ userId: 1, title }).returning();
    return reply.status(201).send(chat);
  });

  fastify.patch('/api/chats/:chatId', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });

    const bodyResult = renameBodySchema.safeParse(request.body);
    if (!bodyResult.success) return reply.status(400).send({ error: 'Invalid request' });

    const [updated] = await db
      .update(chats)
      .set({ title: bodyResult.data.title })
      .where(eq(chats.id, idResult.data))
      .returning();

    if (!updated) return reply.status(404).send({ error: 'Chat not found' });
    return reply.send(updated);
  });

  fastify.delete('/api/chats/:chatId', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });

    const [deleted] = await db
      .delete(chats)
      .where(eq(chats.id, idResult.data))
      .returning();

    if (!deleted) return reply.status(404).send({ error: 'Chat not found' });
    return reply.send({ ok: true });
  });
};

export default chatsRoute;
