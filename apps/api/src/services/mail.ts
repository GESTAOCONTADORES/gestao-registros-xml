import nodemailer from 'nodemailer';
import type { AppConfig } from '../config';
import type { Logger } from '../context';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<boolean>;
}

/** Módulo de e-mail configurável por variáveis de ambiente (SMTP_*). */
export function createMailer(config: AppConfig, log: Logger): Mailer {
  const { host, port, secure, user, password, from } = config.smtp;
  const configured = Boolean(host && from);
  const transport = configured
    ? nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass: password } : undefined,
      })
    : null;

  return {
    configured,
    async send(message) {
      if (!transport) {
        log.warn({ subject: message.subject }, 'SMTP não configurado — e-mail não enviado');
        return false;
      }
      try {
        await transport.sendMail({ from, ...message });
        return true;
      } catch (err) {
        log.error({ err, subject: message.subject }, 'Falha ao enviar e-mail');
        return false;
      }
    },
  };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
