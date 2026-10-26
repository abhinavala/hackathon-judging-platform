/**
 * SCU ACM judging platform — mail relay
 *
 * Mints nothing and decides nothing. The Next.js server creates sign-in links
 * with supabase.auth.admin.generateLink() and posts them here; this only
 * delivers them from the ACM Workspace account.
 *
 * Why this exists: Supabase's built-in mailer is locked at 2 messages/hour,
 * and a Workspace account can send 2,000/day within its own domain. At ~250
 * participants on scu.edu, that difference is the whole architecture.
 *
 * Deploy: Web app, "Execute as: Me", "Who has access: Anyone".
 * "Anyone" is required because our server calls this unauthenticated — the
 * shared secret in the request body is what authorises it, NOT a header,
 * because doPost() cannot read request headers.
 *
 * The secret lives in Script Properties, never in this file.
 */

var SECRET_PROP = 'SHARED_SECRET';
var FROM_NAME   = 'SCU ACM';
var REPLY_TO    = 'acm@scu.edu';

// ---------------------------------------------------------------- entry point
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty_body' });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return json({ ok: false, error: 'bad_json' });
    }

    var expected = PropertiesService.getScriptProperties().getProperty(SECRET_PROP);
    if (!expected) return json({ ok: false, error: 'secret_not_configured' });
    if (body.secret !== expected) return json({ ok: false, error: 'unauthorized' });

    // Health check — proves the deployment and secret work without sending.
    if (body.action === 'ping') {
      return json({
        ok: true,
        pong: true,
        quotaRemaining: MailApp.getRemainingDailyQuota()
      });
    }

    // Accept one message or a batch.
    var messages = body.messages || [{
      email: body.email,
      link: body.link,
      template: body.template,
      data: body.data || {}
    }];

    if (!messages.length) return json({ ok: false, error: 'no_messages' });

    var quota = MailApp.getRemainingDailyQuota();
    if (quota < messages.length) {
      return json({
        ok: false,
        error: 'insufficient_quota',
        quotaRemaining: quota,
        requested: messages.length
      });
    }

    var sent = [], failed = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      try {
        if (!m.email || !m.link) throw new Error('missing_email_or_link');
        var built = render(m.template, m.link, m.data || {});
        MailApp.sendEmail({
          to: m.email,
          subject: built.subject,
          body: built.text,
          htmlBody: built.html,
          name: FROM_NAME,
          replyTo: REPLY_TO
        });
        sent.push(m.email);
      } catch (err) {
        failed.push({ email: m.email || null, error: String(err && err.message || err) });
      }
    }

    return json({
      ok: failed.length === 0,
      sent: sent.length,
      failed: failed,
      quotaRemaining: MailApp.getRemainingDailyQuota()
    });

  } catch (err) {
    return json({ ok: false, error: 'unhandled: ' + String(err && err.message || err) });
  }
}

function doGet() {
  // Deliberately uninformative: this endpoint is public.
  return json({ ok: true, service: 'mail-relay' });
}

// ---------------------------------------------------------------- templates
function render(template, link, data) {
  var team    = data.teamName   || 'your team';
  var inviter = data.inviterName || 'A teammate';
  var code    = data.joinCode   || null;

  switch (template) {

    case 'invite':
      return wrap(
        inviter + ' added you to ' + team,
        '<p>' + esc(inviter) + ' checked in <strong>' + esc(team) +
          '</strong> for the AWS x A10 Hack and listed you as a teammate.</p>' +
          '<p>Sign in to see your judging times and location.</p>',
        'Sign in',
        link,
        code
      );

    case 'schedule':
      return wrap(
        'Your judging times are set',
        '<p>The judging schedule for the AWS x A10 Hack is published.</p>' +
          '<p>Sign in to see both of ' + esc(team) + "'s presentation times and which station to go to.</p>",
        'View your schedule',
        link,
        code
      );

    case 'credentials':
      return wrap(
        'Your AWS credentials are ready',
        '<p>AWS credentials for <strong>' + esc(team) + '</strong> are ready.</p>' +
          '<p>Sign in to view them. They are not included in this email.</p>',
        'View credentials',
        link,
        code
      );

    case 'signin':
    default:
      return wrap(
        'Sign in to the AWS x A10 Hack',
        '<p>Here is your sign-in link.</p>',
        'Sign in',
        link,
        code
      );
  }
}

function wrap(subject, bodyHtml, buttonLabel, link, code) {
  var codeBlock = code
    ? '<p style="margin:24px 0 0;padding:12px 16px;background:#f4f4f2;border-radius:8px;' +
      'font-size:14px;color:#3d3d3a">If the link does not work, you can look up your ' +
      'schedule with your team code <strong style="font-family:monospace;font-size:16px">' +
      esc(code) + '</strong>.</p>'
    : '';

  var html =
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;' +
    'max-width:520px;margin:0 auto;padding:24px;color:#3d3d3a;line-height:1.6">' +
      '<h1 style="font-size:20px;font-weight:500;margin:0 0 16px">' + esc(subject) + '</h1>' +
      bodyHtml +
      '<p style="margin:28px 0"><a href="' + esc(link) + '" ' +
        'style="display:inline-block;background:#1a1a19;color:#ffffff;text-decoration:none;' +
        'padding:12px 24px;border-radius:8px;font-size:15px">' + esc(buttonLabel) + '</a></p>' +
      '<p style="font-size:13px;color:#73726c;margin:0">' +
        'This link expires in 4 hours and can only be used once. ' +
        'If it has expired, request a new one from the sign-in page.</p>' +
      codeBlock +
      '<p style="font-size:13px;color:#73726c;margin:24px 0 0">' +
        'If you were not expecting this, you can ignore it.</p>' +
    '</div>';

  var text =
    subject + '\n\n' +
    bodyHtml.replace(/<[^>]+>/g, '') + '\n\n' +
    link + '\n\n' +
    'This link expires in 4 hours and can only be used once.' +
    (code ? '\n\nTeam code: ' + code : '');

  return { subject: subject, html: html, text: text };
}

// ---------------------------------------------------------------- helpers
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Run once from the editor after setting SHARED_SECRET in Script Properties.
 * Sends one real email to the account that owns this script.
 */
function selfTest() {
  var secret = PropertiesService.getScriptProperties().getProperty(SECRET_PROP);
  if (!secret) throw new Error('Set SHARED_SECRET in Project Settings -> Script Properties first.');

  var me = Session.getActiveUser().getEmail();
  Logger.log('Sending to ' + me + '; daily quota remaining: ' + MailApp.getRemainingDailyQuota());

  var res = doPost({ postData: { contents: JSON.stringify({
    secret: secret,
    template: 'invite',
    email: me,
    link: 'https://example.com/auth/callback?token_hash=TEST&type=magiclink',
    data: { teamName: 'Test Team', inviterName: 'Setup Script', joinCode: 'TEST-0000' }
  }) } });

  Logger.log(res.getContent());
}
