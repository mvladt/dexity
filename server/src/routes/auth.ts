import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';

const bodySchema = z.object({ token: z.string().min(1) });

const authRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/auth/verify', async (request, reply) => {
    const result = bodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }
    if (result.data.token === config.ACCESS_TOKEN) {
      return reply.send({ ok: true });
    }
    return reply.status(401).send({ ok: false, error: 'Invalid token' });
  });
};

export default authRoute;
