#!/usr/bin/env node
// Generates the secrets the Worker needs, using WebCrypto so PBKDF2 output
// matches exactly what crypto.subtle produces inside the Worker.
//
// Usage:
//   node scripts/hash-password.mjs                     # interactive prompt
//   node scripts/hash-password.mjs --password '...'    # from arg
//   node scripts/hash-password.mjs --salt              # random 64-byte hex salt
//
// The printed ADMIN_PASSWORD_HASH is a PBKDF2-SHA256 string in the format
//   pbkdf2$<iterations>$<saltHex>$<dkHex>
// Set it as the Worker secret:  wrangler secret put ADMIN_PASSWORD_HASH
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

if (process.argv.includes("--salt")) {
  console.log(randomBytes(64).toString("hex"));
  process.exit(0);
}

const argvIdx = process.argv.indexOf("--password");
let password = argvIdx !== -1 ? process.argv[argvIdx + 1] : null;

if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await ask(rl, "Enter admin password: ");
  const confirm = await ask(rl, "Confirm admin password: ");
  rl.close();
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
}

// Cloudflare Workers caps WebCrypto PBKDF2 at 100,000 iterations; a hash made
// with more can never be verified inside the Worker.
const ITERATIONS = 100000;
const dkLen = 32;
const salt = randomBytes(16);
const dk = await pbkdf2Password(password, salt, ITERATIONS, dkLen);

const encoded = `pbkdf2$${ITERATIONS}$${salt.toString("hex")}$${dk.toString("hex")}`;
console.log("\nSet this as the Worker secret ADMIN_PASSWORD_HASH:\n");
console.log(encoded);
console.log("\n(Keep it private. It cannot be recovered once set.)");

async function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function pbkdf2Password(password, salt, iterations, keyLen) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    keyLen * 8,
  );
  return Buffer.from(bits);
}