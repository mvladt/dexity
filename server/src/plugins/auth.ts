import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export async function authPreHandler(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const token = auth.slice(7);
  if (token !== config.ACCESS_TOKEN) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
