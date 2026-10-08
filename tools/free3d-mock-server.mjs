#!/usr/bin/env node
// Mock of the free 3D preview API (app.artuplabs.com /api/free-3d*) for manual testing of
// site/tools/photo-to-3d/ — not deployed. Contract: the session prompt of 2026-10-08.
//
//   node tools/free3d-mock-server.mjs            # API on http://localhost:8788
//   python3 -m http.server 8080 -d site          # the site
//   open "http://localhost:8080/tools/photo-to-3d/?api=http://localhost:8788"
//
// Env: PORT (8788), READY_AFTER seconds until "ready" (20), MODE = normal | disabled | cap | ip_limit | fail.
// Special inputs: email "bad@" → 400 bad_email; email "fail@example.com" → the job ends "failed".
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8788);
const READY_AFTER = Number(process.env.READY_AFTER || 20);
const MODE = process.env.MODE || "normal";
const GLB = path.join(here, "../site/ar-xr/photo-to-3d/m-armchair-realistic.glb");
const jobs = new Map();
let remaining = 200;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers,
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; chunks.push(c); });
    req.on("end", () => resolve({ buf: Buffer.concat(chunks), size }));
    req.on("error", reject);
  });
}

function field(buf, name) {
  const m = buf.toString("latin1").match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`));
  return m ? m[1] : null;
}

function statusOf(job) {
  const age = (Date.now() - job.created) / 1000;
  const expiresAt = new Date(job.created + 7 * 86400e3).toISOString();
  if (job.fail && age > READY_AFTER / 2) return { id: job.id, status: "failed", expiresAt, error: "generation_failed" };
  if (age < READY_AFTER * 0.2) return { id: job.id, status: "queued", expiresAt };
  if (age < READY_AFTER * 0.8) return { id: job.id, status: "generating", expiresAt };
  if (age < READY_AFTER) return { id: job.id, status: "processing", expiresAt };
  return { id: job.id, status: "ready", glbUrl: `http://localhost:${PORT}/mock/model.glb`, expiresAt };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(new Date().toISOString(), req.method, url.pathname);
  if (req.method === "OPTIONS") return send(res, 204);

  if (req.method === "GET" && url.pathname === "/mock/model.glb") {
    res.writeHead(200, { "content-type": "model/gltf-binary", "access-control-allow-origin": "*" });
    return fs.createReadStream(GLB).pipe(res);
  }
  if (req.method === "GET" && url.pathname === "/api/free-3d/status") {
    const enabled = !(MODE === "disabled" || MODE === "cap") && remaining > 0;
    return send(res, 200, { enabled, remaining: enabled ? remaining : 0 });
  }
  if (req.method === "POST" && url.pathname === "/api/free-3d") {
    const { buf, size } = await readBody(req);
    if (MODE === "disabled") return send(res, 503, { error: "disabled" });
    if (MODE === "cap") return send(res, 503, { error: "cap_reached" });
    if (MODE === "ip_limit") return send(res, 429, { error: "ip_limit" });
    if (size > 5 * 1024 * 1024 + 64 * 1024) return send(res, 413, { error: "too_large" });
    if (!/name="photo"/.test(buf.toString("latin1"))) return send(res, 400, { error: "bad_file" });
    const email = field(buf, "email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "bad_email" });
    const id = crypto.randomBytes(9).toString("base64url");
    jobs.set(id, { id, created: Date.now(), fail: MODE === "fail" || email === "fail@example.com" });
    remaining--;
    console.log("  job", id, "email:", email ? "yes" : "no", "utm:", field(buf, "utm") || "-");
    return send(res, 202, { id, status: "queued" });
  }
  const m = url.pathname.match(/^\/api\/free-3d\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && m) {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, { error: "not_found" });
    return send(res, 200, statusOf(job));
  }
  send(res, 404, { error: "not_found" });
}).listen(PORT, () => console.log(`free-3d mock API on http://localhost:${PORT} (mode ${MODE}, ready after ${READY_AFTER}s)`));
