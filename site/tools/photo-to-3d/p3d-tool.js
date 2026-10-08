/* Free 3D preview — page logic. Pure helpers live in p3d-core.js (window.P3DCore).
 * API (app.artuplabs.com): GET /api/free-3d/status, POST /api/free-3d (multipart), GET /api/free-3d/:id. */
(function () {
  "use strict";
  var C = window.P3DCore;
  var API = C.resolveApiBase(location.hostname, location.search);
  var POLL_MS = 5000;
  var GIVE_UP_MS = 30 * 60 * 1000;
  var STORE_KEY = "artup.free3d.lastId";
  var VIEWER = "/ar-xr/assets/vendor/model-viewer.min.js";
  var MESHOPT = "/ar-xr/assets/vendor/meshopt_decoder.js";

  var $ = function (id) { return document.getElementById(id); };
  var form = $("p3d-form");
  var input = $("photo");
  var drop = $("drop");
  var preview = $("photo-preview");
  var email = $("email");
  var submit = $("submit");
  var formError = $("form-error");
  var chosen = null;      // { blob, name }
  var previewUrl = null;
  var pollTimer = null;
  var tickTimer = null;

  function show(view) {
    var views = document.querySelectorAll(".tool-view");
    for (var i = 0; i < views.length; i++) views[i].hidden = views[i].getAttribute("data-view") !== view;
  }

  function storeId(id) {
    try { if (id) localStorage.setItem(STORE_KEY, id); else localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
  }
  function storedId() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) { return { status: res.status, body: body }; });
    }, function () { return { status: 0, body: null }; });
  }

  function setError(el, msg) {
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  /* ---------- start ---------- */
  function start() {
    var id = C.parseId(location.search);
    if (id) { follow(id, null); return; }
    fetchJson(API + "/api/free-3d/status").then(function (r) {
      if (r.status === 200 && r.body && r.body.enabled === false) { show("closed"); return; }
      show("form");
      if (r.status === 200 && r.body && typeof r.body.remaining === "number") {
        var rem = $("remaining");
        rem.textContent = "Free previews left: " + r.body.remaining + ".";
        rem.hidden = false;
      }
      var last = storedId();
      if (last && C.parseId("?id=" + last)) {
        var p = $("last-preview");
        var a = document.createElement("a");
        a.href = C.permalink(location.origin, location.pathname, last, location.search);
        a.textContent = "Open your last preview";
        p.appendChild(a);
        p.hidden = false;
      }
    });
  }

  /* ---------- choosing a photo ---------- */
  function decode(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function resize(img, w, h) {
    return new Promise(function (resolve) {
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";           // transparent PNG/WebP → white, not black, in JPEG
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.9);
    });
  }

  function choose(file) {
    setError(formError, "");
    chosen = null;
    submit.disabled = true;
    var err = C.checkFile(file);
    if (err) { setError(formError, C.ERRORS[err]); return; }
    decode(file).then(function (d) {
      var plan = C.planUpload(file, d.img.naturalWidth, d.img.naturalHeight);
      if (plan.action === "reject") { URL.revokeObjectURL(d.url); setError(formError, C.ERRORS[plan.reason]); return null; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = d.url;
      preview.src = d.url;
      preview.hidden = false;
      drop.classList.add("has-photo");
      if (plan.action === "keep") return { blob: file, name: file.name || "photo" };
      return resize(d.img, plan.w, plan.h).then(function (blob) {
        if (!blob || blob.size > C.MAX_BYTES) throw new Error("too_large");
        return { blob: blob, name: (file.name || "photo").replace(/\.[a-z0-9]+$/i, "") + ".jpg" };
      });
    }).then(function (c) {
      if (!c) return;
      chosen = c;
      submit.disabled = false;
    }).catch(function (e) {
      setError(formError, C.ERRORS[e && e.message === "too_large" ? "too_large" : "bad_file"]);
    });
  }

  input.addEventListener("change", function () { if (input.files && input.files[0]) choose(input.files[0]); });
  ["dragenter", "dragover"].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    drop.addEventListener(t, function () { drop.classList.remove("is-over"); });
  });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) choose(f);
  });

  /* ---------- upload ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    setError(formError, "");
    if (!chosen) { setError(formError, C.ERRORS.no_file); return; }
    var mail = email.value.trim();
    if (mail && !C.isEmail(mail)) { setError(formError, C.ERRORS.bad_email); email.focus(); return; }
    var fd = new FormData();
    fd.append("photo", chosen.blob, chosen.name);
    if (mail) fd.append("email", mail);
    var utm = C.extractUtm(location.search);
    if (utm) fd.append("utm", utm);
    submit.disabled = true;
    submit.textContent = "Uploading…";
    fetchJson(API + "/api/free-3d", { method: "POST", body: fd }).then(function (r) {
      submit.textContent = "Make my 3D preview";
      if (r.status === 202 && r.body && r.body.id) {
        storeId(r.body.id);
        var url = C.permalink(location.origin, location.pathname, r.body.id, location.search);
        try { history.replaceState(null, "", url); } catch (err) { /* file:// */ }
        follow(r.body.id, Date.now());
        return;
      }
      var ue = C.uploadError(r.status, r.body);
      if (ue.closed) { show("closed"); return; }
      submit.disabled = false;
      setError(formError, ue.message);
    });
  });

  /* ---------- polling ---------- */
  function follow(id, startedAt) {
    var link = C.permalink(location.origin, location.pathname, id, location.search);
    $("permalink-working").value = link;
    $("permalink-ready").value = link;
    var t0 = startedAt || Date.now();
    var seen = false;
    var failures = 0;

    function tick() { $("elapsed").textContent = C.formatElapsed((Date.now() - t0) / 1000); }

    function stop() {
      clearTimeout(pollTimer);
      clearInterval(tickTimer);
    }

    function poll() {
      fetchJson(API + "/api/free-3d/" + encodeURIComponent(id)).then(function (r) {
        var s = C.mapStatus(r.status, r.body);
        if (s.view === "retry") {
          failures++;
          setError($("working-error"), failures >= 3 ? "We can't reach the server right now — still trying." : "");
          if (!seen) show("working");
          if (Date.now() - t0 > GIVE_UP_MS) { stop(); show("failed"); return; }
          pollTimer = setTimeout(poll, POLL_MS * Math.min(failures, 4));
          return;
        }
        failures = 0;
        setError($("working-error"), "");
        if (s.view === "working") {
          if (!seen) { seen = true; show("working"); tickTimer = setInterval(tick, 1000); tick(); }
          setStep(s.step, s.label);
          if (Date.now() - t0 > GIVE_UP_MS) { stop(); show("failed"); return; }
          pollTimer = setTimeout(poll, POLL_MS);
          return;
        }
        stop();
        if (s.view === "ready") { ready(s); return; }
        if (s.view === "expired") { if (storedId() === id) storeId(null); show("expired"); return; }
        show("failed");
      });
    }
    poll();
  }

  function setStep(step, label) {
    var items = document.querySelectorAll("#steps li");
    for (var i = 0; i < items.length; i++) {
      var n = Number(items[i].getAttribute("data-step"));
      items[i].classList.toggle("is-done", n < step);
      items[i].classList.toggle("is-active", n === step);
    }
    var st = $("working-status");
    if (st.textContent !== label) st.textContent = label;
  }

  function ready(s) {
    show("ready");
    $("download").href = s.glbUrl;
    var exp = C.formatExpiry(s.expiresAt);
    $("expiry").textContent = exp ? "The link and the download work until " + exp + " (7 days), then the photo and the model are deleted." : "The link works for 7 days.";
    var mv = $("result-model");
    var stage = mv.parentNode;
    mv.addEventListener("load", function () { stage.classList.add("is-loaded"); });
    mv.addEventListener("error", function () { $("result-loading").textContent = "The 3D model could not be shown here — use Download GLB."; });
    self.ModelViewerElement = Object.assign(self.ModelViewerElement || {}, {
      meshoptDecoderLocation: new URL(MESHOPT, location.href).href
    });
    mv.setAttribute("src", s.glbUrl);
    if (!customElements.get("model-viewer")) {
      var sc = document.createElement("script");
      sc.type = "module";
      sc.src = VIEWER;
      document.head.appendChild(sc);
    }
  }

  /* ---------- copy link ---------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-copy]") : null;
    if (!btn) return;
    var field = $(btn.getAttribute("data-copy"));
    var done = function () {
      var old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(field.value).then(done, function () { field.select(); });
    } else {
      field.select();
      try { document.execCommand("copy"); done(); } catch (err) { /* user copies by hand */ }
    }
  });

  start();
})();
