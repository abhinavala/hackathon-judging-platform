import "server-only";
import {
  appsScriptSecret,
  appsScriptUrl,
  isProduction,
  linkSenderName,
  mailpitUrl,
} from "@/lib/server-env";

// Which email the link goes out in. Phase 2 adds the check-in receipt and the
// teammate invite; the Apps Script picks subject and body by this name.
export type LinkTemplate = "sign-in";

export type LinkMessage = {
  email: string;
  link: string;
  template: LinkTemplate;
};

// Delivers an already-minted sign-in link. Throws if delivery failed, so the
// caller can tell the person rather than claim an email is on its way.
export interface LinkSender {
  send(message: LinkMessage): Promise<void>;
}

export function getLinkSender(): LinkSender {
  switch (linkSenderName()) {
    case "console":
      return consoleSender;
    case "mailpit":
      return mailpitSender;
    case "appsScript":
      return appsScriptSender;
  }
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
  async send({ email, link, template }) {
    if (isProduction) {
      throw new Error("The mailpit link sender is disabled in production");
    }
    const res = await fetch(`${mailpitUrl()}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: "noreply@judging.local", Name: "Hackathon Judging" },
        To: [{ Email: email }],
        Subject: `Your sign-in link (${template})`,
        Text: `Sign in: ${link}\n\nThis link works once.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Mailpit send failed: HTTP ${res.status}`);
  },
};

// Production: a Google Apps Script web app that sends from the scu.edu
// Workspace account. See docs/auth-and-checkin-flow.md.
//
// The shared secret travels in the JSON body, not a header: an Apps Script
// doPost(e) receives the body and query string but not the request headers,
// so a header secret could never be checked. The script must compare
// `secret` and reply with JSON `{ "ok": true }` once the mail is sent.
const appsScriptSender: LinkSender = {
  async send({ email, link, template }) {
    const res = await fetch(appsScriptUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        link,
        template,
        secret: appsScriptSecret(),
      }),
      // Apps Script answers a POST with a redirect to the script's output.
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Apps Script send failed: HTTP ${res.status}`);
    const body: unknown = await res.json().catch(() => null);
    if (!isOk(body)) {
      throw new Error(`Apps Script send failed: ${JSON.stringify(body)}`);
    }
  },
};

function isOk(body: unknown): boolean {
  return typeof body === "object" && body !== null && "ok" in body
    ? body.ok === true
    : false;
}
