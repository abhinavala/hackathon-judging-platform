import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { render, renderEmail } from "../../lib/auth/templates.ts";
import type { LinkData, LinkTemplate } from "../../lib/auth/relay.ts";

// The reviewed original: apps-script/Code.gs, run as Apps Script would run
// it (top-level vars become globals). Only render() is called, which touches
// no Google service.
const relay = vm.createContext({});
vm.runInContext(
  readFileSync(new URL("../../apps-script/Code.gs", import.meta.url), "utf8"),
  relay,
);
const relayRender = (t: string, link: string, data: LinkData) =>
  vm.runInContext(
    "render(t, link, data)",
    Object.assign(relay, { t, link, data }),
  );

const TEMPLATES: LinkTemplate[] = [
  "signin",
  "checkin",
  "invite",
  "schedule",
  "credentials",
];
const LINK =
  "https://judging.example/auth/callback?token_hash=abc&type=magiclink&email=a%40scu.edu";
const DATA: LinkData[] = [
  {},
  {
    teamName: "ShelterLink",
    inviterName: "Emily Delgado",
    joinCode: "ABCD-1234",
  },
  // Characters the HTML must escape and the text must restore.
  {
    teamName: `R&D <"Lab"> O'Neil`,
    inviterName: "A & B",
    joinCode: "WXYZ-9876",
  },
  { teamName: "Solo", invitedCount: 0 },
  { teamName: "Pair", invitedCount: 1 },
  { teamName: "Six", invitedCount: 5, joinCode: "QRST-0001" },
];

// The team-page URL comes from the link's origin, so cover each environment
// and a link with no usable origin.
const LINKS = [
  LINK,
  "https://hackathon-judging-platfor-git-ce3544-team.vercel.app/auth/callback?token_hash=x&type=magiclink",
  "http://127.0.0.1:3000/auth/callback?token_hash=x&type=magiclink",
  "not a url",
];

test("every template renders exactly what the Apps Script relay renders", () => {
  for (const link of LINKS)
    for (const t of TEMPLATES)
      for (const data of DATA) {
        const ours = render(t, link, data);
        const theirs = relayRender(t, link, data);
        assert.deepEqual(
          { ...ours },
          { subject: theirs.subject, html: theirs.html, text: theirs.text },
          `${link} ${t} ${JSON.stringify(data)}`,
        );
      }
});

test("the code box: the code as the hero, the address once and without https://, the code never expiring", () => {
  for (const t of TEMPLATES) {
    const e = render(t, LINK, {
      teamName: "ShelterLink",
      joinCode: "ABCD-1234",
    });
    // The code, large; and that it outlives the 4-hour link.
    assert.ok(e.html.includes("font-size:24px"), t);
    assert.ok(e.html.includes(">ABCD-1234</p>"), t);
    assert.ok(
      e.html.includes("Your team code works any time, no sign-in needed"),
      t,
    );
    // The link keeps its scheme; the text people read doesn't, and says it once.
    assert.ok(
      e.html.includes(
        '<a href="https://judging.example/t/ABCD-1234" style="color:#1a1a19">judging.example/t/ABCD-1234</a>',
      ),
      t,
    );
    const visible = e.html.replace(/<[^>]+>/g, " ");
    assert.equal(visible.split("judging.example/t/ABCD-1234").length - 1, 1, t);
    assert.ok(!visible.includes("https://judging.example/t"), t);
    assert.ok(
      e.text.endsWith(
        "Your team code works any time, no sign-in needed: ABCD-1234\nYour schedule: judging.example/t/ABCD-1234",
      ),
      t,
    );
    assert.equal(e.text.split("judging.example/t/").length - 1, 1, t);
  }
  const local = render("signin", "http://127.0.0.1:3000/auth/callback?x=1", {
    joinCode: "ABCD-1234",
  });
  assert.match(local.text, /Your schedule: 127\.0\.0\.1:3000\/t\/ABCD-1234$/);
  // No code, no box.
  assert.doesNotMatch(render("signin", LINK, {}).html, /team code/);
});

test("the dry-run subject tag is prefixed as the relay does it", () => {
  const e = renderEmail("invite", LINK, {
    teamName: "ShelterLink",
    subjectTag: "to emily.delgado@scu.example",
  });
  assert.equal(
    e.subject,
    "[to emily.delgado@scu.example] A teammate added you to ShelterLink",
  );
  // The body's heading keeps the untagged subject.
  assert.match(e.html, />A teammate added you to ShelterLink</);
});

test("the plain-text part restores escaped characters and carries the link and code", () => {
  const e = render("checkin", LINK, {
    teamName: `R&D "Lab"`,
    invitedCount: 2,
    joinCode: "ABCD-1234",
  });
  assert.match(e.text, /^R&D "Lab" is checked in\n\n/);
  assert.match(e.text, /We emailed 2 teammates invitations/);
  assert.ok(e.text.includes(`\n\n${LINK}\n\n`));
  assert.match(e.text, /no sign-in needed: ABCD-1234\nYour schedule: /);
  assert.doesNotMatch(e.text, /<|&amp;|&quot;/);
});
