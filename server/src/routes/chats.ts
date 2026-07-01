import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listChats, createChat, renameChat, deleteChat } from '../db/queries.js';

const chatIdSchema = z.coerce.number().int().positive();
const createBodySchema = z.object({ title: z.string().min(1).max(200).optional() });
const renameBodySchema = z.object({ title: z.string().min(1).max(200) });

const chatsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/chats', async (_request, reply) => {
    return reply.send(listChats(1));
  });

  fastify.post('/api/chats', async (request, reply) => {
    const result = createBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request' });
    }
    const title = result.data.title ?? 'Новый чат';
    return reply.status(201).send(createChat(1, title));
  });

  fastify.patch('/api/chats/:chatId', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });

    const bodyResult = renameBodySchema.safeParse(request.body);
    if (!bodyResult.success) return reply.status(400).send({ error: 'Invalid request' });

    const updated = renameChat(idResult.data, bodyResult.data.title);
    if (!updated) return reply.status(404).send({ error: 'Chat not found' });
    return reply.send(updated);
  });

  fastify.delete('/api/chats/:chatId', async (request, reply) => {
    const idResult = chatIdSchema.safeParse((request.params as { chatId: string }).chatId);
    if (!idResult.success) return reply.status(400).send({ error: 'Invalid chatId' });

    if (!deleteChat(idResult.data)) return reply.status(404).send({ error: 'Chat not found' });
    return reply.send({ ok: true });
  });
};

export default chatsRoute;
