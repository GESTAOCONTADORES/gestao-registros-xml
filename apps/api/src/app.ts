import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@gestao/database';
import type { AppConfig } from './config';
import type { AppContext } from './context';
import { HttpError } from './lib/http';
import { agentRoutes } from './routes/agent';
import { authRoutes } from './routes/auth';
import { companyRoutes } from './routes/companies';
import { miscRoutes } from './routes/misc';
import { recordRoutes } from './routes/records';
import { runRoutes } from './routes/runs';
import { userRoutes } from './routes/users';
import { createMailer, type Mailer } from './services/mail';

export interface BuildOptions {
  db: Db;
  config: AppConfig;
  mail?: Mailer;
  logger?: boolean | object;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? {
      level: opts.config.isProduction ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.contentBase64'],
    },
    trustProxy: opts.config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  const ctx: AppContext = {
    db: opts.db,
    config: opts.config,
    mail: opts.mail ?? createMailer(opts.config, app.log),
    log: app.log,
  };
  app.decorate('ctx', ctx);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      // sem Origin = chamadas servidor-servidor (agente, health check)
      if (!origin || opts.config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new HttpError(403, 'Origem não autorizada'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: `Muitas requisições. Aguarde ${Math.ceil(context.ttl / 1000)} segundos e tente novamente.`,
    }),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ statusCode: err.statusCode, code: err.code, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const message =
        status === 413 ? 'Conteúdo muito grande.' : (err as Error).message || 'Requisição inválida.';
      return reply.code(status).send({ statusCode: status, code: (err as { code?: string }).code, message });
    }
    req.log.error({ err }, 'Erro interno');
    return reply.code(500).send({ statusCode: 500, code: 'INTERNAL', message: 'Erro interno. Tente novamente ou contate o suporte.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ statusCode: 404, code: 'NOT_FOUND', message: 'Rota não encontrada.' }));

  app.get('/health', { config: { rateLimit: false } }, async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(companyRoutes);
  await app.register(runRoutes);
  await app.register(recordRoutes);
  await app.register(miscRoutes);
  await app.register(agentRoutes);

  return app;
}
