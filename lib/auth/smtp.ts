// SMTP delivery (Gmail, from the organizer's scu.edu account with an App
// Password). Pure: config comes in as an argument, no env and no
// "server-only", so the app's sender and scripts share it.
//
// Gmail rewrites From to the authenticated account, so the display name is
// what we control: recipients see "SCU ACM <account>", and replies go to the
// club address. The body is the relay's templates (lib/auth/templates.ts).

import nodemailer, { type Transporter } from "nodemailer";
import type { LinkMessage } from "./relay.ts";
import { renderEmail } from "./templates.ts";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  fromName: string;
  replyTo: string;
};

export type SmtpTransport = Transporter;

/** SMTP_* from `env` (process.env or a parsed file); throws naming what's missing. */
export function smtpConfigFrom(
  env: Record<string, string | undefined>,
): SmtpConfig {
  const missing = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM_NAME",
    "SMTP_REPLY_TO",
  ].filter((k) => !env[k]);
  if (missing.length)
    throw new Error(`Missing environment variable ${missing.join(", ")}`);
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0)
    throw new Error(`SMTP_PORT must be a port number (got "${env.SMTP_PORT}")`);
  return {
    host: env.SMTP_HOST!,
    port,
    user: env.SMTP_USER!,
    // Google shows App Passwords in groups of four; the spaces aren't part of it.
    password: env.SMTP_PASSWORD!.replace(/\s+/g, ""),
    fromName: env.SMTP_FROM_NAME!,
    replyTo: env.SMTP_REPLY_TO!,
  };
}

/**
 * 465 is implicit TLS; anything else (587) must upgrade with STARTTLS, and
 * requireTLS refuses to send the password if the upgrade doesn't happen.
 * `pool` keeps one connection open for a batch; close() it when done.
 */
export function createSmtpTransport(
  config: SmtpConfig,
  opts: { pool?: boolean } = {},
): SmtpTransport {
  const secure = config.port === 465;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: !secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(opts.pool ? { pool: true, maxConnections: 1 } : {}),
  });
}

/** The message as nodemailer takes it: rendered template, display name, Reply-To. */
export function buildMail(config: SmtpConfig, m: LinkMessage) {
  const { subject, html, text } = renderEmail(m.template, m.link, m.data);
  return {
    from: { name: config.fromName, address: config.user },
    to: m.email,
    replyTo: config.replyTo,
    subject,
    text,
    html,
  };
}

/**
 * Sends one message. Resolves only when the server accepted the recipient;
 * anything else throws, so a caller never reports a send that didn't happen.
 */
export async function sendSmtp(
  transport: SmtpTransport,
  config: SmtpConfig,
  m: LinkMessage,
): Promise<void> {
  const info = await transport.sendMail(buildMail(config, m));
  const accepted = (info.accepted ?? []).map(String);
  const rejected = (info.rejected ?? []).map(String);
  if (rejected.length > 0 || !accepted.includes(m.email))
    throw new Error(
      `SMTP did not accept ${m.email}: ${info.response ?? "no response"}`,
    );
}
