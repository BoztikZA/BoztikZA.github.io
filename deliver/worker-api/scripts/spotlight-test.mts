import assert from "node:assert/strict";
import { spotlightProfileSaveRequest } from "../../../deliver-v3/js/spotlight-profile-request.mjs";
import { handleSpotlightPublic, safeSocialUrl, uploadSpotlightImage } from "../src/routes/spotlight.ts";
import { HARD_CAP_BYTES, reconcileStorage, releaseStoredPending } from "../src/lib/storage.ts";

type BoundStatement = {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => BoundStatement;
  first: () => Promise<any>;
  run: () => Promise<any>;
  all: () => Promise<any>;
};

class FakeStatement implements BoundStatement {
  args: unknown[] = [];
  readonly db: FakeD1;
  readonly sql: string;

  constructor(db: FakeD1, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...args: unknown[]): BoundStatement {
    this.args = args;
    return this;
  }

  first(): Promise<any> {
    return this.db.first(this.sql, this.args);
  }

  run(): Promise<any> {
    return this.db.run(this.sql, this.args);
  }

  all(): Promise<any> {
    return this.db.all(this.sql, this.args);
  }
}

class FakeD1 {
  profiles = new Map<string, any>();
  pending = new Map<string, any>();
  storage = {
    id: 1,
    limit_bytes: HARD_CAP_BYTES,
    total_bytes: 0,
    reserved_bytes: 0,
    mutation_seq: 0,
    needs_reconcile: 0,
    status: "ok",
    lock_reason: null,
  };
  submissions: any[] = [];
  submissionLimit = new Map<string, { window_start: number; request_count: number }>();
  private queue: Promise<void> = Promise.resolve();

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: BoundStatement[]): Promise<any[]> {
    return this.withLock(() => {
      let changes = 0;
      return statements.map(statement => {
        changes = this.execute(statement.sql, statement.args, changes);
        return { meta: { changes } };
      });
    });
  }

  async first(sql: string, args: unknown[]): Promise<any> {
    if (sql.includes("INSERT INTO spotlight_submission_limits")) {
      return this.withLock(() => {
        const [key, timestamp, resetTime, window, resetTimeAgain, windowAgain, nextStart] = args as number[] | [string, number, number, number, number, number, number];
        const current = this.submissionLimit.get(String(key));
        if (!current) {
          const created = { window_start: Number(timestamp), request_count: 1 };
          this.submissionLimit.set(String(key), created);
          return { ...created };
        }
        if (Number(resetTime) - current.window_start >= Number(window)) {
          current.window_start = Number(nextStart);
          current.request_count = 1;
        } else {
          current.request_count += 1;
        }
        assert.equal(resetTimeAgain, timestamp);
        assert.equal(windowAgain, window);
        return { ...current };
      });
    }
    if (sql.includes("FROM storage_state WHERE id = 1")) return { ...this.storage };
    if (sql.includes("FROM spotlight_profiles WHERE id=?")) {
      const profile = this.profiles.get(String(args[0]));
      return profile ? { ...profile } : null;
    }
    if (sql.includes("FROM pending_uploads WHERE upload_id = ?")) {
      const pending = this.pending.get(String(args[0]));
      return pending ? { ...pending } : null;
    }
    if (sql.includes("FROM pending_uploads") && sql.includes("SUM(CASE WHEN state = 'reserved'")) {
      return {
        reserved: [...this.pending.values()].filter(pending => pending.state === "reserved").reduce((sum, pending) => sum + pending.file_size, 0),
        uploading: [...this.pending.values()].filter(pending => pending.state === "uploading").length,
        spotlight_stored: [...this.pending.values()].filter(pending =>
          pending.state === "stored" && String(pending.r2_key).startsWith("spotlight/")).length,
      };
    }
    return null;
  }

  async run(sql: string, args: unknown[]): Promise<any> {
    return this.withLock(() => ({ meta: { changes: this.execute(sql, args, 0) } }));
  }

  async all(sql: string, args: unknown[]): Promise<any> {
    if (sql.includes("FROM spotlight_profiles") && sql.includes("ORDER BY CASE WHEN featured_until")) {
      return { results: this.directoryRows(sql, args) };
    }
    if (sql.includes("FROM spotlight_profiles")) return { results: [...this.profiles.values()].map(profile => ({ ...profile })) };
    return { results: [] };
  }

  private async withLock<T>(callback: () => T): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return callback();
    } finally {
      release();
    }
  }

  private execute(sql: string, args: unknown[], previousChanges: number): number {
    if (sql.startsWith("INSERT OR IGNORE INTO storage_state")) return 0;
    if (sql.includes("INSERT INTO pending_uploads") && sql.includes("SELECT ?1")) {
      const [uploadId, deliveryId, fileId, r2Key, fileName, fileSize, contentType, createdAt, limit] = args;
      const size = Number(fileSize);
      if (this.storage.status !== "ok" || this.storage.needs_reconcile !== 0
        || this.storage.total_bytes + this.storage.reserved_bytes + size > Number(limit)) return 0;
      this.pending.set(String(uploadId), {
        upload_id: uploadId, delivery_id: deliveryId, file_id: fileId, r2_key: r2Key,
        file_name: fileName, file_size: size, content_type: contentType, created_at: createdAt, state: "reserved",
      });
      return 1;
    }
    if (sql.includes("SET reserved_bytes = reserved_bytes + ?1") && sql.includes("changes() > 0")) {
      if (previousChanges) {
        this.storage.reserved_bytes += Number(args[0]);
        this.storage.mutation_seq += 1;
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("UPDATE pending_uploads SET state = 'uploading'")) {
      const pending = this.pending.get(String(args[0]));
      if (!pending || pending.state !== "reserved") return 0;
      pending.state = "uploading";
      return 1;
    }
    if (sql.startsWith("UPDATE pending_uploads SET state = 'stored'")) {
      const pending = this.pending.get(String(args[0]));
      if (!pending || pending.state !== "uploading") return 0;
      pending.state = "stored";
      pending.stored_at = args[1];
      return 1;
    }
    if (sql.includes("SET reserved_bytes = MAX(0, reserved_bytes - ?1), total_bytes = total_bytes + ?1")) {
      if (previousChanges) {
        const size = Number(args[0]);
        this.storage.reserved_bytes = Math.max(0, this.storage.reserved_bytes - size);
        this.storage.total_bytes += size;
        this.storage.mutation_seq += 1;
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("UPDATE spotlight_profiles SET image_key=")) {
      const [key, size, contentType, updatedAt, profileId, expectedKey] = args;
      const profile = this.profiles.get(String(profileId));
      if (!profile || (profile.image_key ?? null) !== (expectedKey ?? null)) return 0;
      Object.assign(profile, { image_key: key, image_size: size, image_content_type: contentType, updated_at: updatedAt });
      return 1;
    }
    if (sql.startsWith("DELETE FROM pending_uploads") && sql.includes("AND changes()>0")) {
      const pending = this.pending.get(String(args[0]));
      if (previousChanges && pending?.state === "stored") {
        this.pending.delete(String(args[0]));
        return 1;
      }
      return 0;
    }
    if (sql.startsWith("INSERT INTO pending_uploads") && sql.includes("WHERE changes()>0")) {
      if (!previousChanges || !args[9]) return 0;
      const [uploadId, deliveryId, fileId, r2Key, fileName, fileSize, contentType, createdAt, storedAt] = args;
      if ([...this.pending.values()].some(pending => pending.r2_key === r2Key)) throw new Error("duplicate pending R2 key");
      this.pending.set(String(uploadId), {
        upload_id: uploadId, delivery_id: deliveryId, file_id: fileId, r2_key: r2Key,
        file_name: fileName, file_size: fileSize, content_type: contentType, created_at: createdAt,
        stored_at: storedAt, state: "stored",
      });
      return 1;
    }
    if (sql.startsWith("DELETE FROM pending_uploads") && sql.includes("state IN ('reserved','uploading')")) {
      const pending = this.pending.get(String(args[0]));
      if (!pending || !["reserved", "uploading"].includes(pending.state)) return 0;
      this.pending.delete(String(args[0]));
      return 1;
    }
    if (sql.startsWith("DELETE FROM pending_uploads") && sql.includes("state = 'stored'")) {
      const pending = this.pending.get(String(args[0]));
      if (!pending || pending.state !== "stored") return 0;
      this.pending.delete(String(args[0]));
      return 1;
    }
    if (sql.includes("SET reserved_bytes = MAX(0, reserved_bytes - ?1)") && sql.includes("changes() > 0")) {
      if (!previousChanges) return 0;
      this.storage.reserved_bytes = Math.max(0, this.storage.reserved_bytes - Number(args[0]));
      this.storage.mutation_seq += 1;
      return 1;
    }
    if (sql.includes("SET total_bytes = MAX(0, total_bytes - ?1)") && sql.includes("changes() > 0")) {
      if (!previousChanges) return 0;
      this.storage.total_bytes = Math.max(0, this.storage.total_bytes - Number(args[0]));
      this.storage.mutation_seq += 1;
      return 1;
    }
    if (sql.includes("SET total_bytes=total_bytes-?")) {
      const size = Number(args[0]);
      if (this.storage.total_bytes < size) return 0;
      this.storage.total_bytes -= size;
      this.storage.mutation_seq += 1;
      return 1;
    }
    if (sql.includes("SET total_bytes = ?1, reserved_bytes = ?2, needs_reconcile = 0") && sql.includes("mutation_seq = ?6")) {
      if (this.storage.mutation_seq !== Number(args[5])) return 0;
      this.storage.total_bytes = Number(args[0]);
      this.storage.reserved_bytes = Number(args[1]);
      this.storage.needs_reconcile = 0;
      this.storage.status = String(args[2]);
      this.storage.lock_reason = args[3] as string | null;
      return 1;
    }
    if (sql.startsWith("UPDATE storage_state SET mutation_seq=mutation_seq+1,last_mutation_at=?") && sql.includes("changes()>0")) {
      if (!previousChanges) return 0;
      this.storage.mutation_seq += 1;
      return 1;
    }
    if (sql.startsWith("UPDATE storage_state SET mutation_seq = mutation_seq + 1, needs_reconcile = 1")) {
      this.storage.mutation_seq += 1;
      this.storage.needs_reconcile = 1;
      return 1;
    }
    if (sql.startsWith("UPDATE pending_uploads SET state = 'uploading'") && sql.includes("AND state = 'stored'")) {
      const pending = this.pending.get(String(args[0]));
      if (!pending || pending.state !== "stored") return 0;
      pending.state = "uploading";
      return 1;
    }
    if (sql.startsWith("INSERT INTO spotlight_profiles") && sql.includes("WHERE NOT EXISTS")) {
      const [id, slug, displayName, tagline, description, category, email, website, social, song, createdAt, updatedAt, duplicateEmail, duplicateName, cutoff] = args;
      const duplicate = this.submissions.some(profile =>
        profile.contact_email === duplicateEmail
        && profile.display_name.toLowerCase() === String(duplicateName).toLowerCase()
        && profile.status !== "archived"
        && profile.created_at >= Number(cutoff));
      if (duplicate) return 0;
      this.submissions.push({
        id, slug, display_name: displayName, tagline, description, category, contact_email: email,
        website_url: website, social_links: social, song_metadata: song, status: "pending",
        created_at: createdAt, updated_at: updatedAt,
      });
      return 1;
    }
    return 0;
  }

  private directoryRows(sql: string, args: unknown[]): any[] {
    let index = 0;
    let category: string | null = null;
    let query: string | null = null;
    if (sql.includes("AND category=?")) category = String(args[index++]);
    if (sql.includes("lower(display_name) LIKE")) {
      query = String(args[index]).slice(1, -1);
      index += 4;
    }
    let cursor: { featured: number; publishedAt: number; id: string } | null = null;
    if (sql.includes("COALESCE(published_at, created_at) < ?")) {
      index += 1;
      cursor = {
        featured: Number(args[index++]),
        publishedAt: Number(args[index + 2]),
        id: String(args[index + 4]),
      };
    }
    const timestamp = Number(args[args.length - 2]);
    const limit = Number(args[args.length - 1]);
    let rows = [...this.profiles.values()].filter(profile => profile.status === "published");
    if (category) rows = rows.filter(profile => profile.category === category);
    if (query) rows = rows.filter(profile =>
      [profile.display_name, profile.tagline, profile.description, profile.category]
        .some(value => String(value).toLowerCase().includes(query!)));
    const featureGroup = (profile: any) => Number(profile.featured_until || 0) > timestamp ? 0 : 1;
    if (cursor) {
      rows = rows.filter(profile => {
        const group = featureGroup(profile);
        const publishedAt = Number(profile.published_at ?? profile.created_at);
        return group > cursor!.featured
          || (group === cursor!.featured
            && (publishedAt < cursor!.publishedAt
              || (publishedAt === cursor!.publishedAt && profile.id < cursor!.id)));
      });
    }
    return rows.sort((a, b) =>
      featureGroup(a) - featureGroup(b)
      || Number(b.published_at ?? b.created_at) - Number(a.published_at ?? a.created_at)
      || b.id.localeCompare(a.id)).slice(0, limit);
  }
}

class FakeBucket {
  objects = new Map<string, Uint8Array>();
  failPut: "before" | "after" | null = null;
  failDeletes = new Set<string>();
  beforePut: (() => Promise<void>) | null = null;

  async put(key: string, value: Uint8Array): Promise<void> {
    await this.beforePut?.();
    if (this.failPut === "before") throw new Error("R2 put failed before storing bytes");
    this.objects.set(key, value.slice());
    if (this.failPut === "after") throw new Error("R2 put response failed after storing bytes");
  }

  async delete(key: string): Promise<void> {
    if (this.failDeletes.has(key)) throw new Error("R2 delete failed");
    this.objects.delete(key);
  }

  async head(key: string): Promise<{ size: number } | null> {
    const value = this.objects.get(key);
    return value ? { size: value.byteLength } : null;
  }

  async list(options: { prefix?: string }): Promise<any> {
    return {
      objects: [...this.objects].filter(([key]) => !options.prefix || key.startsWith(options.prefix))
        .map(([key, value]) => ({ key, size: value.byteLength, uploaded: new Date() })),
      truncated: false,
    };
  }

  bytes(): number {
    return [...this.objects.values()].reduce((sum, object) => sum + object.byteLength, 0);
  }
}

function makeImage(size: number): Uint8Array {
  const image = new Uint8Array(size);
  image.set([137, 80, 78, 71], 0);
  image.set(new TextEncoder().encode("IEND"), size - 8);
  return image;
}

function makeImageEnv(options: { oldSize?: number; limit?: number } = {}) {
  const profileId = "a".repeat(20);
  const oldKey = `spotlight/${profileId}/${"b".repeat(16)}`;
  const oldSize = options.oldSize ?? 100;
  const db = new FakeD1();
  db.storage.limit_bytes = options.limit ?? HARD_CAP_BYTES;
  db.storage.total_bytes = oldSize;
  db.profiles.set(profileId, {
    id: profileId, image_key: oldKey, image_size: oldSize, image_content_type: "image/png",
  });
  const bucket = new FakeBucket();
  bucket.objects.set(oldKey, makeImage(oldSize));
  return { env: { DB: db, BUCKET: bucket, STORAGE_LIMIT_BYTES: undefined, AUTH_TOKEN_SALT: "test-salt" }, db, bucket, profileId, oldKey, oldSize };
}

function imageRequest(size: number): Request {
  return new Request("https://worker.test/api/admin/spotlight/profile/image", {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: makeImage(size),
  });
}

async function postSubmission(env: any, ip: string, displayName: string): Promise<Response> {
  const body = {
    display_name: displayName,
    tagline: "A distinct and useful creative tagline",
    description: "An independent creator sharing thoughtful work with their community.",
    category: "creator",
    contact_email: `${displayName.replace(/\s+/g, ".").toLowerCase()}@example.com`,
    consent: true,
  };
  const request = new Request("https://worker.test/api/public/spotlight/submit", {
    method: "POST",
    headers: {
      Origin: "https://www.boztik.com",
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
  return handleSpotlightPublic(request, "/submit", env, {} as never);
}

function publishedProfile(id: number, values: Partial<any> = {}): any {
  const identifier = id.toString(16).padStart(20, "0");
  return {
    id: identifier,
    slug: `profile-${identifier}`,
    display_name: `Profile ${id}`,
    tagline: "A clear creator profile",
    description: `Searchable description for profile ${id}`,
    category: "creator",
    contact_email: `creator${id}@example.com`,
    social_links: "{}",
    song_metadata: null,
    image_key: null,
    image_size: 0,
    image_content_type: null,
    status: "published",
    featured_until: null,
    created_at: id,
    published_at: id,
    ...values,
  };
}

console.log("Spotlight manager create/edit requests");
{
  const body = { display_name: "New Creator" };
  const create = spotlightProfileSaveRequest("", body);
  assert.equal(create.path, "/api/admin/spotlight/profile");
  assert.equal(create.init.method, "POST");
  assert.deepEqual(JSON.parse(create.init.body), body);
  const edit = spotlightProfileSaveRequest("a/b", body);
  assert.equal(edit.path, "/api/admin/spotlight/profile/a%2Fb");
  assert.equal(edit.init.method, "PATCH");
  assert.deepEqual(JSON.parse(edit.init.body), body);
}

console.log("Platform-specific social URL validation");
{
  assert.ok(safeSocialUrl("instagram", "https://www.instagram.com/creator"));
  assert.ok(safeSocialUrl("youtube", "https://music.youtube.com/channel/abc"));
  assert.ok(safeSocialUrl("youtube", "https://youtu.be/abcdefghijkl"));
  assert.ok(safeSocialUrl("x", "https://twitter.com/creator"));
  assert.ok(safeSocialUrl("spotify", "https://open.spotify.com/artist/abc"));
  for (const [platform, value] of [
    ["instagram", "https://instagram.com.example.org/user"],
    ["instagram", "https://evil.example/instagram.com"],
    ["instagram", "http://instagram.com/user"],
    ["instagram", "javascript:alert(1)"],
    ["instagram", "https://user@instagram.com/creator"],
    ["facebook", "https://fakefacebook.com/user"],
    ["spotify", "https://spotify.com.attacker.test/artist/abc"],
  ]) assert.equal(safeSocialUrl(platform, value), null, `${platform} should reject ${value}`);
}

console.log("Spotlight image replacement and shared storage accounting");
{
  const { env, db, bucket, profileId, oldKey, oldSize } = makeImageEnv();
  const response = await uploadSpotlightImage(imageRequest(24), env as never, profileId);
  assert.equal(response.status, 200);
  const profile = db.profiles.get(profileId);
  assert.equal(profile.image_size, 24);
  assert.equal(bucket.objects.has(oldKey), false);
  assert.equal(db.storage.total_bytes, 24);
  assert.equal(db.storage.reserved_bytes, 0);
  assert.equal(bucket.bytes(), db.storage.total_bytes);
  assert.equal(db.pending.size, 0);
}

console.log("Two simultaneous replacements use compare-and-swap");
{
  const { env, db, bucket, profileId, oldKey } = makeImageEnv();
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  bucket.beforePut = async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await gate;
  };
  const results = await Promise.allSettled([
    uploadSpotlightImage(imageRequest(24), env as never, profileId),
    uploadSpotlightImage(imageRequest(27), env as never, profileId),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  const profile = db.profiles.get(profileId);
  assert.equal(bucket.objects.has(oldKey), false);
  assert.equal(bucket.objects.get(profile.image_key)?.byteLength, profile.image_size);
  assert.equal(bucket.bytes(), db.storage.total_bytes);
  assert.equal(db.storage.total_bytes, profile.image_size);
  assert.equal(db.storage.reserved_bytes, 0);
  assert.equal(db.pending.size, 0);
}

console.log("Failed upload rolls back its reservation");
{
  const { env, db, bucket, profileId, oldSize } = makeImageEnv();
  bucket.failPut = "before";
  await assert.rejects(uploadSpotlightImage(imageRequest(22), env as never, profileId));
  assert.equal(db.storage.total_bytes, oldSize);
  assert.equal(db.storage.reserved_bytes, 0);
  assert.equal(bucket.bytes(), oldSize);
  assert.equal(db.pending.size, 0);
}

console.log("Ambiguous upload failure retains the shared reservation");
{
  const { env, db, bucket, profileId, oldSize } = makeImageEnv();
  bucket.failPut = "after";
  bucket.delete = async function (key: string) {
    if (key !== `spotlight/${profileId}/${"b".repeat(16)}`) throw new Error("R2 delete unavailable");
    this.objects.delete(key);
  };
  await assert.rejects(uploadSpotlightImage(imageRequest(22), env as never, profileId));
  assert.equal(db.storage.total_bytes, oldSize);
  assert.equal(db.storage.reserved_bytes, 22);
  assert.equal(bucket.bytes(), oldSize + 22);
  assert.equal(db.storage.needs_reconcile, 1);
  assert.equal([...db.pending.values()][0].state, "uploading");
}

console.log("Failed deletion keeps both images charged and requests reconciliation");
{
  const { env, db, bucket, profileId, oldKey } = makeImageEnv();
  bucket.failDeletes.add(oldKey);
  await assert.rejects(uploadSpotlightImage(imageRequest(23), env as never, profileId));
  assert.equal(db.profiles.get(profileId).image_size, 23);
  assert.equal(bucket.bytes(), db.storage.total_bytes);
  assert.equal(db.storage.total_bytes, 123);
  assert.equal(db.storage.reserved_bytes, 0);
  assert.equal(db.storage.needs_reconcile, 1);
}

console.log("Ambiguous image deletion remains accounted until cleanup confirms absence");
{
  const { env, db, bucket, profileId, oldKey } = makeImageEnv();
  let ambiguousDelete = true;
  bucket.delete = async function (key: string) {
    this.objects.delete(key);
    if (key === oldKey && ambiguousDelete) {
      ambiguousDelete = false;
      throw new Error("R2 delete response lost after deleting the object");
    }
  };
  await assert.rejects(uploadSpotlightImage(imageRequest(23), env as never, profileId));
  assert.equal(bucket.bytes(), 23);
  assert.equal(db.storage.total_bytes, 123);
  assert.equal(db.storage.needs_reconcile, 1);

  const deferred = await reconcileStorage(env as never);
  assert.equal(deferred.deferred, true);
  assert.equal(db.storage.total_bytes, 123);

  const deletion = [...db.pending.values()].find(pending => pending.r2_key === oldKey)!;
  await bucket.delete(oldKey);
  await releaseStoredPending(env as never, deletion.upload_id, deletion.file_size);
  const reconciled = await reconcileStorage(env as never);
  assert.equal(reconciled.deferred, false);
  assert.equal(db.storage.total_bytes, bucket.bytes());
  assert.equal(db.storage.total_bytes, 23);
  assert.equal(db.storage.needs_reconcile, 0);
}

console.log("Shared storage cap rejects before writing");
{
  const { env, db, bucket, profileId } = makeImageEnv({ oldSize: HARD_CAP_BYTES - 10 });
  await assert.rejects(
    uploadSpotlightImage(imageRequest(20), env as never, profileId),
    (error: any) => error.code === "storage_full",
  );
  assert.equal(bucket.bytes(), HARD_CAP_BYTES - 10);
  assert.equal(db.storage.reserved_bytes, 0);
}

console.log("Directory pagination, sorting, filtering, and cursor boundaries");
{
  const db = new FakeD1();
  const timestamp = Math.floor(Date.now() / 1000);
  const rows = [
    publishedProfile(1, { display_name: "Featured", featured_until: timestamp + 3600, category: "music", published_at: 1 }),
    publishedProfile(2, { display_name: "Expired feature", featured_until: timestamp - 1, category: "creator", published_at: 5 }),
    publishedProfile(3, { display_name: "Second creator", category: "creator", published_at: 4, description: "needle phrase" }),
    publishedProfile(4, { display_name: "Other creator", category: "creator", published_at: 3 }),
    publishedProfile(5, { display_name: "Newest", category: "creator", published_at: 2 }),
    publishedProfile(6, { display_name: "Pending", status: "pending", published_at: 99 }),
  ];
  rows.forEach(row => db.profiles.set(row.id, row));
  const env = { DB: db, ALLOWED_ORIGINS: "https://www.boztik.com", PUBLIC_ORIGIN: "https://www.boztik.com" };
  const collected: string[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const url = new URL("https://worker.test/api/public/spotlight?limit=2");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await handleSpotlightPublic(new Request(url), "", env as never, {} as never);
    const data = await response.json() as any;
    assert.equal(response.status, 200);
    collected.push(...data.profiles.map((profile: any) => profile.id));
    cursor = data.next_cursor;
    hasMore = data.has_more;
  }
  assert.equal(new Set(collected).size, rows.length - 1);
  assert.equal(collected.length, rows.length - 1);
  assert.equal(collected[0], rows[0].id);
  assert.ok(collected.includes(rows[1].id), "expired featured profiles remain in the directory");

  const filtered = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight?q=needle&category=creator&limit=5"), "", env as never, {} as never);
  const filteredData = await filtered.json() as any;
  assert.deepEqual(filteredData.profiles.map((profile: any) => profile.id), [rows[2].id]);

  const category = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight?category=creator&limit=10"), "", env as never, {} as never);
  const categoryData = await category.json() as any;
  assert.ok(categoryData.profiles.every((profile: any) => profile.category === "creator"));
  assert.equal(categoryData.profiles.length, 4);

  const movingDb = new FakeD1();
  const movingRows = [
    // Must still be featured when page one is read; a 1s margin made this race the wall clock.
    publishedProfile(11, { featured_until: timestamp + 300, published_at: 11 }),
    publishedProfile(12, { published_at: 10 }),
    publishedProfile(13, { published_at: 9 }),
  ];
  movingRows.forEach(row => movingDb.profiles.set(row.id, row));
  const movingEnv = { DB: movingDb };
  const firstPage = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight?limit=1"), "", movingEnv as never, {} as never);
  const firstPageData = await firstPage.json() as any;
  assert.equal(firstPageData.profiles[0].id, movingRows[0].id);
  movingRows[0].featured_until = timestamp - 1;
  movingRows[1].featured_until = timestamp + 3600;
  const secondPage = await handleSpotlightPublic(
    new Request(`https://worker.test/api/public/spotlight?limit=1&cursor=${encodeURIComponent(firstPageData.next_cursor)}`),
    "",
    movingEnv as never,
    {} as never,
  );
  const secondPageData = await secondPage.json() as any;
  assert.equal(secondPageData.profiles[0].id, movingRows[1].id, "feature expiry or promotion between pages does not repeat/skip profiles");

  const invalidCursor = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight?cursor=not-valid!"), "", env as never, {} as never);
  assert.equal(invalidCursor.status, 400);
}

console.log("Submission duplicate prevention and persistent rate limit");
{
  const db = new FakeD1();
  const env = {
    DB: db,
    AUTH_TOKEN_SALT: "test-salt",
    ALLOWED_ORIGINS: "https://www.boztik.com",
    PUBLIC_ORIGIN: "https://www.boztik.com",
  };
  const first = await postSubmission(env, "198.51.100.10", "Repeat Creator");
  const duplicate = await postSubmission(env, "198.51.100.10", "Repeat Creator");
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as any).duplicate, true);
  assert.equal(db.submissions.length, 1);

  for (let index = 0; index < 5; index += 1) {
    const response = await postSubmission(env, "198.51.100.20", `Creator ${index}`);
    assert.equal(response.status, 201);
  }
  const sixth = await postSubmission(env, "198.51.100.20", "Creator too many");
  assert.equal(sixth.status, 429);
}

console.log("All Spotlight regression tests passed.");
