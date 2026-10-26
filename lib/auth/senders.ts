import "server-only";
import { SUPABASE_URL } from "@/lib/env";
import { callRelay, type LinkMessage } from "@/lib/auth/relay";
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

export function getLinkSender(): LinkSender {
  const sender = {
    console: consoleSender,
    mailpit: mailpitSender,
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
  return { send: (m) => sender.send(redirectMessage(m, inboxes)) };
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

// Production: a Google Apps Script web app that sends from the scu.edu
// Workspace account. See docs/auth-and-checkin-flow.md.
//
// The wire format and the secret-in-the-body rule are in lib/auth/relay.ts.
// The templates read `data` (team name, join code); without it they fall
// back to "your team".
const appsScriptSender: LinkSender = {
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
