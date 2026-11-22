import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { rotateSpotlightFeature } from "../src/lib/cleanup.ts";
class Statement {
  args: unknown[] = [];
  constructor(readonly db: TestD1, readonly sql: string) {}
  bind(...args: unknown[]) { this.args=args; return this; }
  async first() { return (this.db.raw.prepare(this.sql).get(...(this.args as never[])) as any) ?? null; }
  async all() { return { results:this.db.raw.prepare(this.sql).all(...(this.args as never[])) as any[] }; }
  async run() { const result=this.db.raw.prepare(this.sql).run(...(this.args as never[])); return { meta:{changes:Number(result.changes)} }; }
}
class TestD1 {
  raw=new DatabaseSync(":memory:");
  prepare(sql:string) { return new Statement(this,sql); }
  async batch(statements:Statement[]) {
    const results:unknown[]=[]; this.raw.exec("BEGIN");
    try { for(const statement of statements) results.push(await statement.run()); this.raw.exec("COMMIT"); return results; }
    catch(error) { this.raw.exec("ROLLBACK"); throw error; }
  }
}
const db=new TestD1();
const migrations=new URL("../migrations/",import.meta.url);
for(const file of readdirSync(migrations).filter(name=>name.endsWith(".sql")).sort()) db.raw.exec(readFileSync(new URL(file,migrations),"utf8"));
const now=Math.floor(Date.now()/1000);
const add=db.raw.prepare("INSERT INTO spotlight_profiles(id,slug,display_name,tagline,description,category,contact_email,status,application_status,created_at,updated_at,published_at,listing_expires_at) VALUES(?,?,?,?,?,?,?,'published','published',?,?,?,?)");
add.run("aaaaaaaaaaaaaaaaaaaa","alpha","Alpha Studio","Alpha makes things","A published profile used to test the automatic rotation lifecycle.","creator","",now-200,now-200,now-200,now+30*86400);
add.run("bbbbbbbbbbbbbbbbbbbb","bravo","Bravo Studio","Bravo makes things","A published profile used to test the automatic rotation lifecycle.","creator","",now-100,now-100,now-100,now+30*86400);
const env={DB:db} as never;
const first=await rotateSpotlightFeature(env);
assert.equal(first.rotated,true);
assert.equal(first.featured_id,"aaaaaaaaaaaaaaaaaaaa");
const alphaExpiry=(db.raw.prepare("SELECT listing_expires_at FROM spotlight_profiles WHERE id=?").get("aaaaaaaaaaaaaaaaaaaa") as any).listing_expires_at;
const immediate=await rotateSpotlightFeature(env);
assert.equal(immediate.rotated,false);
assert.equal(immediate.featured_id,"aaaaaaaaaaaaaaaaaaaa");
db.raw.prepare("UPDATE spotlight_rotation_state SET next_rotation_at=? WHERE id=1").run(now-1);
db.raw.prepare("UPDATE spotlight_profiles SET featured_until=? WHERE id=?").run(now-1,"aaaaaaaaaaaaaaaaaaaa");
const second=await rotateSpotlightFeature(env);
assert.equal(second.rotated,true);
assert.equal(second.featured_id,"bbbbbbbbbbbbbbbbbbbb");
assert.equal(Number((db.raw.prepare("SELECT listing_expires_at FROM spotlight_profiles WHERE id=?").get("aaaaaaaaaaaaaaaaaaaa") as any).listing_expires_at),Number(alphaExpiry));
assert.equal(Number((db.raw.prepare("SELECT listing_expires_at FROM spotlight_profiles WHERE id=?").get("bbbbbbbbbbbbbbbbbbbb") as any).listing_expires_at),now+30*86400);
console.log("Spotlight 24-hour rotation tests passed.");
