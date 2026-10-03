#!/usr/bin/env node
// Cache busting for the static site: rewrites every local .css/.js reference (href="…" / src="…")
// in the HTML pages to "<path>?v=<first 8 hex of the file's SHA-256>".
//
// Why: Cloudflare serves CSS/JS with "max-age=14400" (zone browser TTL) while HTML is served with
// "max-age=0, must-revalidate". A content hash in the URL makes a changed file a new URL right after
// a deploy, and an unchanged file keeps its cached copy — no extra revalidation requests.
//
// Usage: node scripts/stamp-assets.mjs [root=site] [--check]
//   --check  change nothing; exit 1 if any page is not stamped with the current hashes.
// Idempotent: a second run changes nothing. Skips <root>/ar-xr/demo/** (build output of the demo repo,
// it manages its own assets) and any reference that is external or does not resolve to a file.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const root = path.resolve(args.find((a) => !a.startsWith("--")) || "site");
const excluded = [path.join(root, "ar-xr", "demo")];

const isExcluded = (p) => excluded.some((dir) => p === dir || p.startsWith(dir + path.sep));

function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isExcluded(full)) continue;
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const hashes = new Map();
function hashOf(file) {
  if (!hashes.has(file)) hashes.set(file, createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8));
  return hashes.get(file);
}

// href="…" / src="…" whose path (before ? or #) ends in .css or .js
const ATTR = /\b(href|src)=(["'])([^"'?#]+\.(?:css|js))(\?[^"'#]*)?(#[^"']*)?\2/g;

function stamp(html, file) {
  const missing = [];
  const result = html.replace(ATTR, (match, attr, quote, urlPath, query = "", hash = "") => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(urlPath)) return match; // external or data: URL
    const target = urlPath.startsWith("/")
      ? path.join(root, urlPath)
      : path.resolve(path.dirname(file), urlPath);
    if (!target.startsWith(root + path.sep) || isExcluded(target)) return match;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { missing.push(urlPath); return match; }
    const params = new URLSearchParams(query.slice(1));
    params.set("v", hashOf(target));
    return `${attr}=${quote}${urlPath}?${params.toString()}${hash}${quote}`;
  });
  return { result, missing };
}

let changed = 0;
let refs = 0;
for (const file of htmlFiles(root)) {
  const html = fs.readFileSync(file, "utf8");
  const { result, missing } = stamp(html, file);
  refs += (html.match(ATTR) || []).length;
  for (const m of missing) console.warn(`stamp-assets: ${path.relative(root, file)}: ${m} not found, left as is`);
  if (result === html) continue;
  changed++;
  if (check) console.log(`stamp-assets: needs stamping: ${path.relative(root, file)}`);
  else fs.writeFileSync(file, result);
}
console.log(`stamp-assets: ${refs} asset references, ${changed} page(s) ${check ? "out of date" : "updated"} under ${root}`);
if (check && changed) process.exit(1);
