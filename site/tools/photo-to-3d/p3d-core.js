/* Free 3D preview — pure helpers (no DOM, no network). Loaded as a classic script before p3d-tool.js;
 * also run by the unit tests in tools/test/p3d-core.test.mjs (node --test). */
(function (root) {
  "use strict";

  var DEFAULT_API = "https://app.artuplabs.com";
  var MAX_BYTES = 5 * 1024 * 1024;        // the API limit for the uploaded photo
  var MAX_INPUT_BYTES = 25 * 1024 * 1024; // larger files are not even decoded in the browser
  var MAX_SIDE = 2048;
  var TYPES = ["image/jpeg", "image/png", "image/webp"];
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  var LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

  function params(search) {
    try { return new URLSearchParams(search || ""); } catch (e) { return new URLSearchParams(""); }
  }

  /* API base: the production API, or ?api=<http(s) URL> only when the page itself runs on localhost. */
  function resolveApiBase(hostname, search) {
    if (LOCAL_HOSTS.indexOf(String(hostname || "")) === -1) return DEFAULT_API;
    var api = params(search).get("api");
    if (!api) return DEFAULT_API;
    try {
      var u = new URL(api);
      if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_API;
      return (u.origin + u.pathname).replace(/\/+$/, "");
    } catch (e) {
      return DEFAULT_API;
    }
  }

  /* utm_* query params → "utm_source=x&utm_campaign=y" (known keys only, values ≤ 100 chars), or "". */
  function extractUtm(search) {
    var p = params(search);
    var out = new URLSearchParams();
    UTM_KEYS.forEach(function (k) {
      var v = p.get(k);
      if (v) out.set(k, v.slice(0, 100));
    });
    return out.toString();
  }

  /* A preview id from ?id= (letters, digits, - and _, up to 64), or null. */
  function parseId(search) {
    var id = params(search).get("id");
    return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  }

  /* Before decoding: type and absolute size. Returns null when the file may be read. */
  function checkFile(file) {
    if (!file) return "no_file";
    if (TYPES.indexOf(String(file.type || "").toLowerCase()) === -1) return "bad_type";
    if (!(file.size > 0)) return "bad_type";
    if (file.size > MAX_INPUT_BYTES) return "too_large";
    return null;
  }

  /* Long side scaled down to MAX_SIDE, never up. */
  function scaleDims(w, h, max) {
    max = max || MAX_SIDE;
    var long = Math.max(w, h);
    if (!(long > max)) return { w: w, h: h, scaled: false };
    var k = max / long;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
  }

  /* After decoding: keep the original file only if it is small enough on both counts. */
  function planUpload(file, w, h) {
    var err = checkFile(file);
    if (err) return { action: "reject", reason: err };
    if (Math.min(w, h) < 256) return { action: "reject", reason: "too_small" };
    var d = scaleDims(w, h);
    if (!d.scaled && file.size <= MAX_BYTES) return { action: "keep" };
    return { action: "resize", w: d.w, h: d.h };
  }

  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim()) && String(s).length <= 254;
  }

  /* GET /api/free-3d/:id → what the page shows. */
  function mapStatus(httpStatus, body) {
    if (httpStatus === 404) return { view: "expired" };
    if (httpStatus !== 200 || !body) return { view: "retry" };
    switch (body.status) {
      case "queued": return { view: "working", step: 1, label: "Waiting in the queue" };
      case "generating": return { view: "working", step: 2, label: "Generating the 3D model" };
      case "processing": return { view: "working", step: 3, label: "Optimizing the model for the web and AR" };
      case "ready":
        return body.glbUrl ? { view: "ready", glbUrl: body.glbUrl, expiresAt: body.expiresAt || null }
          : { view: "failed", error: "no_model" };
      case "failed": return { view: "failed", error: body.error || "failed" };
      default: return { view: "retry" };
    }
  }

  var ERRORS = {
    no_file: "Choose a photo first.",
    bad_type: "Use a JPEG, PNG or WebP photo.",
    bad_file: "We couldn't read this photo. Try a JPEG, PNG or WebP file.",
    too_small: "This photo is too small. Use a larger, sharper photo of the item.",
    too_large: "This photo is too large. Use one under 5 MB.",
    bad_email: "This email address doesn't look right — fix it or leave the field empty.",
    ip_limit: "One free preview per day — come back tomorrow or install the app.",
    cap_reached: "Free previews are used up — install the app to add 3D to your whole catalog.",
    disabled: "Free previews are used up — install the app to add 3D to your whole catalog.",
    network: "We couldn't reach the server. Check your connection and try again.",
    server: "Something went wrong on our side. Please try again in a few minutes."
  };

  /* POST /api/free-3d error → { code, message, closed } (closed: hide the form for good). */
  function uploadError(httpStatus, body) {
    var code = body && body.error;
    if (httpStatus === 400) code = ERRORS[code] ? code : "bad_file";
    else if (httpStatus === 413) code = "too_large";
    else if (httpStatus === 429) code = "ip_limit";
    else if (httpStatus === 503) code = code === "disabled" ? "disabled" : "cap_reached";
    else if (httpStatus === 0) code = "network";
    else code = "server";
    return { code: code, message: ERRORS[code], closed: code === "cap_reached" || code === "disabled" };
  }

  function formatElapsed(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  /* "Link works until 15 Oct 2026" — or null when expiresAt is missing or not a date. */
  function formatExpiry(expiresAt) {
    if (!expiresAt) return null;
    var d = new Date(expiresAt);
    if (isNaN(d.getTime())) return null;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  /* Permalink to a preview on this page; keeps ?api= only for local testing. */
  function permalink(origin, pathname, id, search) {
    var q = new URLSearchParams();
    q.set("id", id);
    var api = params(search).get("api");
    if (api && /^http:\/\/(localhost|127\.0\.0\.1)/.test(origin)) q.set("api", api);
    return origin + pathname + "?" + q.toString();
  }

  var api = {
    DEFAULT_API: DEFAULT_API, MAX_BYTES: MAX_BYTES, MAX_SIDE: MAX_SIDE, ERRORS: ERRORS,
    resolveApiBase: resolveApiBase, extractUtm: extractUtm, parseId: parseId, checkFile: checkFile,
    scaleDims: scaleDims, planUpload: planUpload, isEmail: isEmail, mapStatus: mapStatus,
    uploadError: uploadError, formatElapsed: formatElapsed, formatExpiry: formatExpiry, permalink: permalink
  };
  root.P3DCore = api;
})(typeof window !== "undefined" ? window : globalThis);
