import Fastify from 'fastify';
import { config } from './config.js';
import { sqlite } from './db/client.js';
import { migrate } from './db/migrate.js';
import { authPreHandler } from './plugins/auth.js';
import authRoute from './routes/auth.js';
import chatsRoute from './routes/chats.js';
import messagesRoute from './routes/messages.js';

migrate(sqlite);

const isDev = config.NODE_ENV === 'development';

const fastify = Fastify({
  logger: { level: isDev ? 'debug' : 'info' },
  bodyLimit: 102_400,
});

if (isDev) {
  const cors = await import('@fastify/cors');
  await fastify.register(cors.default, { origin: config.CORS_ORIGIN });
}

fastify.register(authRoute);

fastify.register(async (app) => {
  app.addHook('preHandler', authPreHandler);
  app.register(chatsRoute);
  app.register(messagesRoute);
});

try {
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
