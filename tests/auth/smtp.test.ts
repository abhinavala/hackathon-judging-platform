import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import {
  buildMail,
  createSmtpTransport,
  sendSmtp,
  smtpConfigFrom,
  type SmtpTransport,
} from "../../lib/auth/smtp.ts";
import type { LinkMessage } from "../../lib/auth/relay.ts";

const ENV = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_USER: "organizer@scu.example",
  SMTP_PASSWORD: "abcd efgh ijkl mnop",
  SMTP_FROM_NAME: "SCU ACM",
  SMTP_REPLY_TO: "acm@scu.example",
};
const config = smtpConfigFrom(ENV);
const MESSAGE: LinkMessage = {
  email: "emily.delgado@scu.example",
  link: "https://judging.example/auth/callback?token_hash=abc&type=magiclink",
  template: "invite",
  data: {
    teamName: "ShelterLink",
    inviterName: "Sam Ortiz",
    joinCode: "ABCD-1234",
  },
};

test("config: every SMTP_* is required, the port is a number, App Password spaces go", () => {
  assert.equal(config.password, "abcdefghijklmnop");
  assert.equal(config.port, 587);
  assert.throws(
    () =>
      smtpConfigFrom({ ...ENV, SMTP_PASSWORD: undefined, SMTP_REPLY_TO: "" }),
    /Missing environment variable SMTP_PASSWORD, SMTP_REPLY_TO/,
  );
  assert.throws(
    () => smtpConfigFrom({ ...ENV, SMTP_PORT: "smtp" }),
    /SMTP_PORT must be a port number/,
  );
});

test("587 must upgrade with STARTTLS; 465 is implicit TLS", () => {
  const starttls = createSmtpTransport(config);
  const opts = (t: SmtpTransport) =>
    (t as unknown as { options: Record<string, unknown> }).options;
  assert.equal(opts(starttls).secure, false);
  assert.equal(opts(starttls).requireTLS, true);
  const implicit = createSmtpTransport({ ...config, port: 465 });
  assert.equal(opts(implicit).secure, true);
  starttls.close();
  implicit.close();
});

test("the message reads 'SCU ACM <account>', replies go to the club, both parts present", async () => {
  // Render the real MIME message without a server.
  const stream = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const info = await stream.sendMail(buildMail(config, MESSAGE));
  const raw = (info.message as Buffer).toString("utf8");
  assert.match(raw, /^From: SCU ACM <organizer@scu\.example>\r?$/m);
  assert.match(raw, /^Reply-To: acm@scu\.example\r?$/m);
  assert.match(raw, /^To: emily\.delgado@scu\.example\r?$/m);
  assert.match(raw, /^Subject: Sam Ortiz added you to ShelterLink\r?$/m);
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Content-Type: text\/html/);
  assert.deepEqual(info.envelope, {
    from: "organizer@scu.example",
    to: ["emily.delgado@scu.example"],
  });
});

test("the redirect's subject tag reaches the email", () => {
  const mail = buildMail(config, {
    ...MESSAGE,
    email: "test-inbox@scu.example",
    data: { ...MESSAGE.data, subjectTag: `to ${MESSAGE.email}` },
  });
  assert.equal(mail.to, "test-inbox@scu.example");
  assert.equal(
    mail.subject,
    "[to emily.delgado@scu.example] Sam Ortiz added you to ShelterLink",
  );
});

// A stand-in transport: sendSmtp only reads sendMail's reply.
const fake = (reply: object | Error) =>
  ({
    sendMail: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  }) as unknown as SmtpTransport;

test("a send succeeds only when the server accepted the recipient", async () => {
  await sendSmtp(
    fake({ accepted: [MESSAGE.email], rejected: [], response: "250 OK" }),
    config,
    MESSAGE,
  );
  await assert.rejects(
    sendSmtp(
      fake({ accepted: [], rejected: [MESSAGE.email], response: "550 no" }),
      config,
      MESSAGE,
    ),
    /SMTP did not accept emily\.delgado@scu\.example: 550 no/,
  );
  // No recipient list at all is not a success either.
  await assert.rejects(sendSmtp(fake({}), config, MESSAGE), /did not accept/);
  await assert.rejects(
    sendSmtp(fake(new Error("Invalid login: 535-5.7.8")), config, MESSAGE),
    /Invalid login/,
  );
});
