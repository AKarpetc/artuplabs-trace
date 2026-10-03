/* ArtUp AR XR — lazy model tiles for the "Photo → 3D" showcase.
 *
 * Markup: <model-viewer data-src="photo-to-3d/x.glb" ...> inside a .p3d-tile.
 * Nothing heavy loads with the page: the self-hosted model-viewer script (and its meshopt decoder,
 * the models are EXT_meshopt_compression) is injected the first time a tile comes near the viewport,
 * and each tile gets its src only when it is about to be seen.
 */
(function () {
  "use strict";

  var VIEWER = "assets/vendor/model-viewer.min.js";
  var MESHOPT = "assets/vendor/meshopt_decoder.js";
  var viewerRequested = false;

  function loadViewer() {
    if (viewerRequested) return;
    viewerRequested = true;
    var decoder = MESHOPT;
    try { decoder = new URL(MESHOPT, document.baseURI).href; } catch (e) { /* keep relative */ }
    self.ModelViewerElement = Object.assign(self.ModelViewerElement || {}, { meshoptDecoderLocation: decoder });
    var s = document.createElement("script");
    s.type = "module";
    s.src = VIEWER;
    document.head.appendChild(s);
  }

  function tileOf(mv) { return mv.closest ? mv.closest(".p3d-tile") : null; }

  function reveal(mv) {
    var src = mv.getAttribute("data-src");
    if (!src || mv.getAttribute("src")) return;
    loadViewer();
    mv.setAttribute("src", src);
  }

  var viewers = document.querySelectorAll("model-viewer[data-src]");
  if (!viewers.length) return;

  Array.prototype.forEach.call(viewers, function (mv) {
    mv.addEventListener("load", function () {
      var t = tileOf(mv);
      if (t) { t.classList.remove("is-error"); t.classList.add("is-loaded"); }
    });
    mv.addEventListener("error", function () {
      var t = tileOf(mv);
      if (t) t.classList.add("is-error");
    });
  });

  if (!("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(viewers, reveal);
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      reveal(entry.target);
    });
  }, { rootMargin: "200px 0px" });

  Array.prototype.forEach.call(viewers, function (mv) { io.observe(mv); });
})();
