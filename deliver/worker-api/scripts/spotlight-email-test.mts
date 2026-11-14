import assert from "node:assert/strict";
import { enqueueSpotlightEmail, processSpotlightEmailOutbox } from "../src/lib/spotlight-email.ts";

class EmailStatement {
  args: unknown[] = [];
  constructor(readonly db: EmailDb, readonly sql: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  run() { return this.db.run(this.sql, this.args); }
  all() { return this.db.all(this.sql, this.args); }
}

class EmailDb {
  profiles = new Map<string, any>();
  outbox = new Map<string, any>();
  prepare(sql: string) { return new EmailStatement(this, sql); }

  async run(sql: string, args: unknown[]) {
    if (sql.startsWith("INSERT OR IGNORE INTO spotlight_email_outbox")) {
      const [id, profile_id, kind, ref, recipient, next_attempt_at, created_at] = args;
      if ([...this.outbox.values()].some(item => item.profile_id === profile_id && item.kind === kind && item.ref === ref)) return { meta: { changes: 0 } };
      this.outbox.set(String(id), { id, profile_id, kind, ref, recipient, state: "pending", attempts: 0, next_attempt_at, created_at });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET state='sending'")) {
      const [locked_until, id] = args;
      const item = this.outbox.get(String(id));
      if (!item || (item.state === "pending" && item.next_attempt_at > Math.floor(Date.now() / 1000))
        || (item.state === "sending" && item.locked_until > Math.floor(Date.now() / 1000))) return { meta: { changes: 0 } };
      Object.assign(item, { state: "sending", locked_until });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET state='sent'")) {
      const [sent_at, id] = args;
      Object.assign(this.outbox.get(String(id)), { state: "sent", sent_at, locked_until: null, last_error: null });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET state='pending',attempts=attempts+1")) {
      const [next_attempt_at, last_error, id] = args;
      const item = this.outbox.get(String(id));
      Object.assign(item, { state: "pending", attempts: item.attempts + 1, next_attempt_at, locked_until: null, last_error });
      return { meta: { changes: 1 } };
    }
    throw new Error("Unexpected email DB write: " + sql);
  }

  async all(sql: string, args: unknown[]) {
    assert.ok(sql.includes("FROM spotlight_email_outbox e"));
    const [timestamp, _lockTimestamp, profileId, _profileAgain, kind, _kindAgain, max] = args;
    const due = [...this.outbox.values()]
      .filter(item => item.profile_id === profileId || profileId === null)
      .filter(item => item.kind === kind || kind === null)
      .filter(item =>
        (item.state === "pending" && item.next_attempt_at <= Number(timestamp))
        || (item.state === "sending" && item.locked_until <= Number(timestamp)))
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, Number(max))
      .map(item => ({ ...item, ...this.profiles.get(item.profile_id) }));
    return { results: due };
  }
}

const db = new EmailDb();
db.profiles.set("submission-1", {
  display_name: "North Star Studio", category: "design", tagline: "Distinct design for local makers",
  contact_email: "maker@example.com", website_url: "https://example.com/", slug: "north-star",
});
db.profiles.set("submission-2", {
  display_name: "North Star Studio", category: "design", tagline: "Distinct design for local makers",
  contact_email: "maker@example.com", website_url: "https://example.com/", slug: "north-star",
  decline_reason: "Please add clearer details about your services.",
});

console.log("New submission alerts stay queued until email configuration is available");
await enqueueSpotlightEmail({ DB: db } as never, "submission-1", "new_submission");
await enqueueSpotlightEmail({ DB: db } as never, "submission-1", "new_submission");
assert.equal(db.outbox.size, 1, "unique profile/kind outbox rows prevent duplicate alerts");
const unavailable = await processSpotlightEmailOutbox({ DB: db } as never, 10, "submission-1", "new_submission");
assert.deepEqual(unavailable, { sent: 0, deferred: 1 });
const ownerAlert = [...db.outbox.values()][0];
assert.equal(ownerAlert.state, "pending");
assert.equal(ownerAlert.attempts, 1);
assert.equal(ownerAlert.last_error, "email_not_configured");

console.log("Owner alerts retry with an idempotency key and use current recipient configuration");
ownerAlert.next_attempt_at = 0;
const originalFetch = globalThis.fetch;
const sentBodies: Array<{ url: string; headers: Headers; body: any }> = [];
globalThis.fetch = async (input, init) => {
  sentBodies.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
  return new Response(null, { status: 200 });
};
try {
  const sent = await processSpotlightEmailOutbox({
    DB: db,
    NOTIFY_EMAIL_TO: "owner@example.com",
    NOTIFY_EMAIL_FROM: "spotlight@example.com",
    EMAIL_PROVIDER_URL: "https://mail.example.test/send",
    EMAIL_PROVIDER_KEY: "test-key",
  } as never, 10, "submission-1", "new_submission");
  assert.deepEqual(sent, { sent: 1, deferred: 0 });
  assert.equal(ownerAlert.state, "sent");
  assert.equal(sentBodies[0]?.body.to, "owner@example.com");
  assert.match(sentBodies[0]?.body.text, /North Star Studio/);
  assert.equal(sentBodies[0]?.headers.get("Idempotency-Key"), ownerAlert.id);
  assert.equal(sentBodies[0]?.headers.get("Authorization"), "Bearer test-key");

  console.log("Decline notices include the saved reason and retry transient provider failures");
  await enqueueSpotlightEmail({ DB: db } as never, "submission-2", "declined", "maker@example.com");
  const declined = [...db.outbox.values()].find(item => item.kind === "declined")!;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const failed = await processSpotlightEmailOutbox({
    DB: db,
    NOTIFY_EMAIL_FROM: "spotlight@example.com",
    EMAIL_PROVIDER_URL: "https://mail.example.test/send",
  } as never, 10, "submission-2", "declined");
  assert.deepEqual(failed, { sent: 0, deferred: 1 });
  assert.equal(declined.state, "pending");
  assert.equal(declined.last_error, "email_provider_http_503");

  declined.next_attempt_at = 0;
  globalThis.fetch = async (_input, init) => {
    sentBodies.push({ url: "retry", headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  };
  const retried = await processSpotlightEmailOutbox({
    DB: db,
    NOTIFY_EMAIL_FROM: "spotlight@example.com",
    EMAIL_PROVIDER_URL: "https://mail.example.test/send",
  } as never, 10, "submission-2", "declined");
  assert.deepEqual(retried, { sent: 1, deferred: 0 });
  assert.equal(declined.state, "sent");
  assert.match(sentBodies.at(-1)?.body.text, /Please add clearer details about your services/);

  console.log("Repeatable information requests are not de-duplicated away; identical ones are");
  db.profiles.get("submission-2")!.info_request_note = "Please send a link to your portfolio.";
  db.profiles.get("submission-2")!.info_response_note = "Here is my portfolio link.";
  await enqueueSpotlightEmail({ DB: db } as never, "submission-2", "info_requested", null, "100");
  await enqueueSpotlightEmail({ DB: db } as never, "submission-2", "info_requested", null, "100");
  await enqueueSpotlightEmail({ DB: db } as never, "submission-2", "info_requested", null, "200");
  assert.equal([...db.outbox.values()].filter(item => item.kind === "info_requested").length, 2);

  console.log("Applicant emails go to the applicant; applicant replies go to the team; neither leaks the owner link");
  sentBodies.length = 0;
  globalThis.fetch = async (_input, init) => {
    sentBodies.push({ url: "x", headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  };
  const config = { DB: db, NOTIFY_EMAIL_TO: "owner@example.com", NOTIFY_EMAIL_FROM: "spotlight@example.com", EMAIL_PROVIDER_URL: "https://mail.example.test/send" } as never;
  await enqueueSpotlightEmail({ DB: db } as never, "submission-2", "info_received", null, "300");
  await enqueueSpotlightEmail({ DB: db } as never, "submission-2", "approved");
  const report = await processSpotlightEmailOutbox(config, 10, "submission-2");
  assert.equal(report.sent, 4, "two info requests, one reply alert, one approval");
  const byText = (re: RegExp) => sentBodies.find(m => re.test(m.body.text))!;
  const request = byText(/Please send a link to your portfolio/);
  assert.equal(request.body.to, "maker@example.com");
  assert.match(request.body.subject, /more information/i);
  const reply = byText(/Here is my portfolio link/);
  assert.equal(reply.body.to, "owner@example.com");
  const approved = byText(/has been approved/);
  assert.equal(approved.body.to, "maker@example.com");
  for (const m of sentBodies) assert.doesNotMatch(m.body.text, /[A-Za-z0-9_-]{43}/, "no token-shaped secret in any email");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("All Spotlight outbox tests passed.");
