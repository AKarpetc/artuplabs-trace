/* Guides: demo 3D tiles. <model-viewer data-src="…"> inside .p3d-tile gets its src (and the self-hosted
 * model-viewer + meshopt decoder from /ar-xr/assets/vendor/) only when it scrolls near the viewport. */
(function () {
  "use strict";
  var VIEWER = "/ar-xr/assets/vendor/model-viewer.min.js";
  var MESHOPT = "/ar-xr/assets/vendor/meshopt_decoder.js";
  var requested = false;

  function loadViewer() {
    if (requested) return;
    requested = true;
    self.ModelViewerElement = Object.assign(self.ModelViewerElement || {}, {
      meshoptDecoderLocation: new URL(MESHOPT, location.href).href
    });
    var s = document.createElement("script");
    s.type = "module";
    s.src = VIEWER;
    document.head.appendChild(s);
  }

  var viewers = document.querySelectorAll("model-viewer[data-src]");
  if (!viewers.length) return;

  function reveal(mv) {
    if (mv.getAttribute("src")) return;
    loadViewer();
    mv.setAttribute("src", mv.getAttribute("data-src"));
  }

  Array.prototype.forEach.call(viewers, function (mv) {
    mv.addEventListener("load", function () {
      var stage = mv.closest(".p3d-stage");
      if (stage) stage.classList.add("is-loaded");
    });
    mv.addEventListener("error", function () {
      var ph = mv.parentNode && mv.parentNode.querySelector(".ph");
      if (ph) ph.textContent = "The 3D model could not be loaded.";
    });
  });

  if (!("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(viewers, reveal);
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      reveal(e.target);
    });
  }, { rootMargin: "200px 0px" });
  Array.prototype.forEach.call(viewers, function (mv) { io.observe(mv); });
})();
