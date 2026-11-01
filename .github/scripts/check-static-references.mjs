import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "_site"]);
const sourceFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(?:html|js|css)$/i.test(entry.name)) sourceFiles.push(absolute);
  }
}

function localPath(ownerFile, rawReference) {
  let reference = rawReference.trim();
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null;
  try {
    reference = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
  if (!/\.(?:js|css)$/i.test(reference)) return null;
  const resolved = reference.startsWith("/")
    ? path.resolve(root, "." + reference)
    : path.resolve(path.dirname(ownerFile), reference);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

walk(root);
const missing = [];

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf8");
  const references = [];

  if (file.endsWith(".html")) {
    for (const match of content.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      references.push(match[1]);
    }
  }

  if (file.endsWith(".js")) {
    const patterns = [
      /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) references.push(match[1]);
    }
  }

  if (file.endsWith(".css")) {
    for (const match of content.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/gi)) {
      references.push(match[1]);
    }
  }

  for (const reference of references) {
    const target = localPath(file, reference);
    if (target && !fs.existsSync(target)) {
      missing.push({ from: path.relative(root, file), reference });
    }
  }
}

if (missing.length) {
  console.error("Missing local JavaScript/CSS references:");
  for (const item of missing) console.error(`- ${item.from} -> ${item.reference}`);
  process.exitCode = 1;
} else {
  console.log(`Static reference check passed (${sourceFiles.length} HTML, JS and CSS files scanned).`);
}
