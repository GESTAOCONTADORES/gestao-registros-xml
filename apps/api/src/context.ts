import type { Db } from '@gestao/database';
import type { Role } from '@gestao/shared';
import type { AppConfig } from './config';
import type { Mailer } from './services/mail';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface AppContext {
  db: Db;
  config: AppConfig;
  mail: Mailer;
  log: Logger;
}

export interface AuthUser {
  id: number;
  role: Role;
  firstName: string;
  lastName: string;
  department: string;
  username: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}
