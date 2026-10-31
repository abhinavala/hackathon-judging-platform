// The email templates, ported line for line from apps-script/Code.gs so the
// SMTP sender sends exactly what the relay would. Pure: no env, no
// "server-only", so the app's sender and scripts share it.
//
// Code.gs stays the reviewed original. tests/auth/templates.test.ts runs it
// in a sandbox and asserts this port renders byte-identical subject, HTML and
// text for every template, so an edit to one without the other fails a test.

import type { LinkData, LinkTemplate } from "./relay.ts";

export type RenderedEmail = { subject: string; html: string; text: string };

/** The relay's render(), plus its subject tag for dry-run redirects. */
export function renderEmail(
  template: LinkTemplate,
  link: string,
  data: LinkData = {},
): RenderedEmail {
  const built = render(template, link, data);
  // Dry runs redirect links to test inboxes and tag the subject with the real
  // recipient (the server decides; this only prefixes).
  if (data.subjectTag)
    built.subject = `[${String(data.subjectTag).slice(0, 120)}] ${built.subject}`;
  return built;
}

export function render(
  template: LinkTemplate,
  link: string,
  data: LinkData,
): RenderedEmail {
  const team = data.teamName || "your team";
  const inviter = data.inviterName || "A teammate";
  const code = data.joinCode || null;

  switch (template) {
    case "checkin": {
      // The captain's receipt: proof the check-in landed, even if they never
      // click the link, with the join code that works without signing in.
      const invited = Number(data.invitedCount) || 0;
      return wrap(
        team + " is checked in",
        "<p><strong>" +
          esc(team) +
          "</strong> is checked in for the AWS x A10 Hack.</p>" +
          (invited
            ? "<p>We emailed " +
              invited +
              (invited === 1
                ? " teammate an invitation"
                : " teammates invitations") +
              " to join. If someone did not get theirs, they can sign in with their own email.</p>"
            : "") +
          "<p>Sign in to see your judging times and location.</p>",
        "Sign in",
        link,
        code,
      );
    }

    case "invite":
      return wrap(
        inviter + " added you to " + team,
        "<p>" +
          esc(inviter) +
          " checked in <strong>" +
          esc(team) +
          "</strong> for the AWS x A10 Hack and listed you as a teammate.</p>" +
          "<p>Sign in to see your judging times and location.</p>",
        "Sign in",
        link,
        code,
      );

    case "schedule":
      return wrap(
        "Your judging times are set",
        "<p>The judging schedule for the AWS x A10 Hack is published.</p>" +
          "<p>Sign in to see both of " +
          esc(team) +
          "'s presentation times and which station to go to.</p>",
        "View your schedule",
        link,
        code,
      );

    case "credentials":
      return wrap(
        "Your AWS credentials are ready",
        "<p>AWS credentials for <strong>" +
          esc(team) +
          "</strong> are ready.</p>" +
          "<p>Sign in to view them. They are not included in this email.</p>",
        "View credentials",
        link,
        code,
      );

    case "signin":
    default:
      return wrap(
        "Sign in to the AWS x A10 Hack",
        "<p>Here is your sign-in link.</p>",
        "Sign in",
        link,
        code,
      );
  }
}

function wrap(
  subject: string,
  bodyHtml: string,
  buttonLabel: string,
  link: string,
  code: string | null,
): RenderedEmail {
  const codeBlock = code
    ? '<p style="margin:24px 0 0;padding:12px 16px;background:#f4f4f2;border-radius:8px;' +
      'font-size:14px;color:#3d3d3a">If the link does not work, you can look up your ' +
      'schedule with your team code <strong style="font-family:monospace;font-size:16px">' +
      esc(code) +
      "</strong>.</p>"
    : "";

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;' +
    'max-width:520px;margin:0 auto;padding:24px;color:#3d3d3a;line-height:1.6">' +
    '<h1 style="font-size:20px;font-weight:500;margin:0 0 16px">' +
    esc(subject) +
    "</h1>" +
    bodyHtml +
    '<p style="margin:28px 0"><a href="' +
    esc(link) +
    '" ' +
    'style="display:inline-block;background:#1a1a19;color:#ffffff;text-decoration:none;' +
    'padding:12px 24px;border-radius:8px;font-size:15px">' +
    esc(buttonLabel) +
    "</a></p>" +
    '<p style="font-size:13px;color:#73726c;margin:0">' +
    "This link expires in 4 hours and can only be used once. " +
    "If it has expired, request a new one from the sign-in page.</p>" +
    codeBlock +
    '<p style="font-size:13px;color:#73726c;margin:24px 0 0">' +
    "If you were not expecting this, you can ignore it.</p>" +
    "</div>";

  const text =
    subject +
    "\n\n" +
    plain(bodyHtml) +
    "\n\n" +
    link +
    "\n\n" +
    "This link expires in 4 hours and can only be used once." +
    (code ? "\n\nTeam code: " + code : "");

  return { subject, html, text };
}

// HTML body -> plain text: paragraphs on their own lines, tags dropped,
// esc()'d characters restored (a team called "R&D" stays "R&D").
function plain(html: string): string {
  return html
    .replace(/<\/p>\s*/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function esc(s: unknown): string {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
