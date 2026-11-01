import "server-only";
import { SUPABASE_URL } from "@/lib/env";
import { callRelay, type LinkMessage } from "@/lib/auth/relay";
import { createSmtpTransport, sendSmtp, smtpConfigFrom } from "@/lib/auth/smtp";
import {
  parseInboxes,
  redirectMessage,
  redirectRefusal,
} from "@/lib/auth/redirect";
import {
  appsScriptSecret,
  appsScriptUrl,
  isProduction,
  linkRedirectInboxes,
  linkSenderName,
  mailpitUrl,
} from "@/lib/server-env";

export type { LinkMessage, LinkTemplate } from "@/lib/auth/relay";

// Delivers an already-minted sign-in link. Throws if delivery failed, so the
// caller can tell the person rather than claim an email is on its way.
export interface LinkSender {
  send(message: LinkMessage): Promise<void>;
}

/** Per-message outcome of sendAll(): the addresses that failed, and why. */
export type BatchOutcome = { failed: { email: string; error: string }[] };

/**
 * Several messages in one go (a check-in's receipt and invites). The relay
 * takes them as one request; the local senders loop. Never throws: a failed
 * send is reported per address, because the caller has already done the
 * durable work and only needs to say what didn't go out.
 */
export async function sendAll(
  sender: LinkSender & { batch?: (m: LinkMessage[]) => Promise<BatchOutcome> },
  messages: LinkMessage[],
): Promise<BatchOutcome> {
  if (sender.batch) {
    try {
      return await sender.batch(messages);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { failed: messages.map((m) => ({ email: m.email, error })) };
    }
  }
  const failed: BatchOutcome["failed"] = [];
  for (const m of messages) {
    try {
      await sender.send(m);
    } catch (e) {
      failed.push({
        email: m.email,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { failed };
}

export function getLinkSender(): LinkSender {
  const sender = {
    console: consoleSender,
    mailpit: mailpitSender,
    smtp: smtpSender,
    appsScript: appsScriptSender,
  }[linkSenderName()];
  const inboxes = parseInboxes(linkRedirectInboxes());
  if (inboxes.length === 0) return sender;
  // Dry run: refuse on production (by project ref and by deployment), then
  // send each link to a test inbox with the real recipient in the subject.
  const refusal = redirectRefusal({
    supabaseUrl: SUPABASE_URL,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (refusal) throw new Error(`AUTH_LINK_REDIRECT_TO is set, but ${refusal}`);
  const original = sender as typeof sender & {
    batch?: (m: LinkMessage[]) => Promise<BatchOutcome>;
  };
  return {
    send: (m) => sender.send(redirectMessage(m, inboxes)),
    ...(original.batch
      ? {
          // Failures come back by test inbox, which is all the relay knows.
          batch: (ms: LinkMessage[]) =>
            original.batch!(ms.map((m, i) => redirectMessage(m, inboxes, i))),
        }
      : {}),
  } as LinkSender;
}

// Local dev: print the link to the server log. Refuses to run in production,
// where it would write live sign-in links into the hosting provider's logs.
const consoleSender: LinkSender = {
  async send({ email, link, template }) {
    if (isProduction) {
      throw new Error("The console link sender is disabled in production");
    }
    console.info(`[auth] ${template} link for ${email}: ${link}`);
  },
};

// Local dev: deliver into the Mailpit inbox bundled with `supabase start`
// (http://127.0.0.1:54324), through its HTTP send API, so the email can be
// opened on another device on the same network.
const mailpitSender: LinkSender = {
  async send({ email, link, template, data }) {
    if (isProduction) {
      throw new Error("The mailpit link sender is disabled in production");
    }
    const res = await fetch(`${mailpitUrl()}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: "noreply@judging.local", Name: "Hackathon Judging" },
        To: [{ Email: email }],
        Subject: `Your sign-in link (${template})${data?.subjectTag ? ` [${data.subjectTag}]` : ""}`,
        Text:
          `Sign in: ${link}\n\nThis link works once.` +
          (data?.teamName
            ? `\n\nTeam: ${data.teamName}${data.joinCode ? ` (code ${data.joinCode})` : ""}`
            : ""),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Mailpit send failed: HTTP ${res.status}`);
  },
};

// Production: Gmail SMTP from the organizer's scu.edu account with an App
// Password (2,000 messages/day, an established domain, and the same domain as
// most recipients). Templates and From/Reply-To are in lib/auth/smtp.ts.
// A batch (a check-in's receipt and invites) shares one connection and sends
// in order; each address succeeds or fails on its own.
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD (an App Password),
// SMTP_FROM_NAME, SMTP_REPLY_TO. All server-only; read per send.
const smtpConfig = () => smtpConfigFrom(process.env);

const smtpSender: LinkSender & {
  batch: (m: LinkMessage[]) => Promise<BatchOutcome>;
} = {
  async batch(messages) {
    const config = smtpConfig();
    const transport = createSmtpTransport(config, { pool: true });
    const failed: BatchOutcome["failed"] = [];
    try {
      for (const m of messages) {
        try {
          await sendSmtp(transport, config, m);
        } catch (e) {
          failed.push({
            email: m.email,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      transport.close();
    }
    return { failed };
  },
  async send(message) {
    const config = smtpConfig();
    const transport = createSmtpTransport(config);
    try {
      await sendSmtp(transport, config, message);
    } finally {
      transport.close();
    }
  },
};

// Alternative, not in use: a Google Apps Script web app (apps-script/Code.gs)
// sending from a Workspace account. Kept working in case SMTP is ever
// unavailable, but a Workspace on its free trial caps Apps Script at 100
// recipients/day, far short of an event. See docs/auth-and-checkin-flow.md.
//
// The wire format and the secret-in-the-body rule are in lib/auth/relay.ts.
// The templates read `data` (team name, join code); without it they fall
// back to "your team".
const appsScriptSender: LinkSender & {
  batch: (m: LinkMessage[]) => Promise<BatchOutcome>;
} = {
  async batch(messages) {
    const reply = await callRelay(
      appsScriptUrl(),
      appsScriptSecret(),
      { messages },
      60_000,
    );
    if (reply.ok) return { failed: [] };
    if (reply.failed)
      return {
        failed: reply.failed.map((f) => ({
          email: f.email ?? "?",
          error: f.error,
        })),
      };
    const error = reply.error ?? JSON.stringify(reply);
    return { failed: messages.map((m) => ({ email: m.email, error })) };
  },
  async send(message) {
    const reply = await callRelay(
      appsScriptUrl(),
      appsScriptSecret(),
      message,
      15_000,
    );
    if (!reply.ok)
      throw new Error(`Apps Script send failed: ${JSON.stringify(reply)}`);
  },
};
