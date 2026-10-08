// Unit tests for the pure helpers of the free 3D preview page (site/tools/photo-to-3d/p3d-core.js).
// Run: node --test tools/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../../site/tools/photo-to-3d/p3d-core.js"), "utf8");
const ctx = { URL, URLSearchParams };
ctx.window = ctx;
vm.runInNewContext(src, ctx);
const C = ctx.P3DCore;
const MB = 1024 * 1024;

test("API base: production by default, ?api= only on localhost", () => {
  assert.equal(C.resolveApiBase("artuplabs.com", "?api=http://localhost:8788"), "https://app.artuplabs.com");
  assert.equal(C.resolveApiBase("localhost", ""), "https://app.artuplabs.com");
  assert.equal(C.resolveApiBase("localhost", "?api=http://localhost:8788/"), "http://localhost:8788");
  assert.equal(C.resolveApiBase("127.0.0.1", "?api=http://127.0.0.1:8788"), "http://127.0.0.1:8788");
  assert.equal(C.resolveApiBase("localhost", "?api=javascript:alert(1)"), "https://app.artuplabs.com");
  assert.equal(C.resolveApiBase("localhost", "?api=not a url"), "https://app.artuplabs.com");
});

test("utm extraction keeps known utm_* keys only and trims long values", () => {
  assert.equal(C.extractUtm(""), "");
  assert.equal(C.extractUtm("?id=1&ref=x"), "");
  assert.equal(
    C.extractUtm("?utm_source=youtube&utm_medium=shorts&utm_campaign=p2&utm_foo=1&id=7"),
    "utm_source=youtube&utm_medium=shorts&utm_campaign=p2"
  );
  const long = "a".repeat(300);
  assert.equal(C.extractUtm("?utm_content=" + long), "utm_content=" + "a".repeat(100));
});

test("preview id from the query string is validated", () => {
  assert.equal(C.parseId("?id=abc_DEF-123"), "abc_DEF-123");
  assert.equal(C.parseId("?id=../../etc"), null);
  assert.equal(C.parseId("?id="), null);
  assert.equal(C.parseId("?id=" + "x".repeat(65)), null);
  assert.equal(C.parseId(""), null);
});

test("file checks: type and size", () => {
  assert.equal(C.checkFile(null), "no_file");
  assert.equal(C.checkFile({ type: "image/jpeg", size: 2 * MB }), null);
  assert.equal(C.checkFile({ type: "image/png", size: 1 }), null);
  assert.equal(C.checkFile({ type: "image/webp", size: 4 * MB }), null);
  assert.equal(C.checkFile({ type: "image/gif", size: 1 * MB }), "bad_type");
  assert.equal(C.checkFile({ type: "image/heic", size: 1 * MB }), "bad_type");
  assert.equal(C.checkFile({ type: "image/jpeg", size: 0 }), "bad_type");
  assert.equal(C.checkFile({ type: "image/jpeg", size: 26 * MB }), "too_large");
});

test("upload plan: keep small files, downscale big ones to ≤ 2048 px and ≤ 5 MB", () => {
  assert.deepEqual({ ...C.planUpload({ type: "image/jpeg", size: 1 * MB }, 1600, 1200) }, { action: "keep" });
  assert.deepEqual({ ...C.planUpload({ type: "image/jpeg", size: 3 * MB }, 4032, 3024) }, { action: "resize", w: 2048, h: 1536 });
  assert.deepEqual({ ...C.planUpload({ type: "image/png", size: 6 * MB }, 1800, 1800) }, { action: "resize", w: 1800, h: 1800 });
  assert.deepEqual({ ...C.planUpload({ type: "image/jpeg", size: 1 * MB }, 200, 900) }, { action: "reject", reason: "too_small" });
  assert.deepEqual({ ...C.planUpload({ type: "image/gif", size: 1 * MB }, 900, 900) }, { action: "reject", reason: "bad_type" });
  const d = C.scaleDims(3000, 5000);
  assert.equal(Math.max(d.w, d.h), 2048);
  assert.equal(C.scaleDims(800, 600).scaled, false);
});

test("status mapping", () => {
  assert.equal(C.mapStatus(404, null).view, "expired");
  assert.equal(C.mapStatus(500, null).view, "retry");
  assert.equal(C.mapStatus(200, { status: "queued" }).step, 1);
  assert.equal(C.mapStatus(200, { status: "generating" }).step, 2);
  assert.equal(C.mapStatus(200, { status: "processing" }).step, 3);
  const r = C.mapStatus(200, { status: "ready", glbUrl: "https://x/m.glb", expiresAt: "2026-10-15T00:00:00Z" });
  assert.equal(r.view, "ready");
  assert.equal(r.glbUrl, "https://x/m.glb");
  assert.equal(C.mapStatus(200, { status: "ready" }).view, "failed");
  assert.equal(C.mapStatus(200, { status: "failed", error: "gen" }).error, "gen");
  assert.equal(C.mapStatus(200, { status: "weird" }).view, "retry");
});

test("upload errors map to the agreed messages", () => {
  assert.equal(C.uploadError(400, { error: "bad_email" }).code, "bad_email");
  assert.equal(C.uploadError(400, { error: "too_small" }).code, "too_small");
  assert.equal(C.uploadError(400, { error: "???" }).code, "bad_file");
  assert.equal(C.uploadError(413, null).code, "too_large");
  const ip = C.uploadError(429, { error: "ip_limit" });
  assert.equal(ip.message, "One free preview per day — come back tomorrow or install the app.");
  assert.equal(ip.closed, false);
  assert.equal(C.uploadError(503, { error: "cap_reached" }).closed, true);
  assert.equal(C.uploadError(503, { error: "disabled" }).code, "disabled");
  assert.equal(C.uploadError(0, null).code, "network");
  assert.equal(C.uploadError(500, null).code, "server");
});

test("formatting helpers", () => {
  assert.equal(C.formatElapsed(0), "0:00");
  assert.equal(C.formatElapsed(65.9), "1:05");
  assert.equal(C.formatElapsed(209), "3:29");
  assert.equal(C.formatExpiry("2026-10-15T10:00:00Z"), "15 Oct 2026");
  assert.equal(C.formatExpiry("nope"), null);
  assert.equal(C.isEmail("a@b.co"), true);
  assert.equal(C.isEmail("a@b"), false);
  assert.equal(C.permalink("https://artuplabs.com", "/tools/photo-to-3d/", "abc", "?api=http://evil"),
    "https://artuplabs.com/tools/photo-to-3d/?id=abc");
  assert.equal(C.permalink("http://localhost:8080", "/tools/photo-to-3d/", "abc", "?api=http://localhost:8788"),
    "http://localhost:8080/tools/photo-to-3d/?id=abc&api=http%3A%2F%2Flocalhost%3A8788");
});
