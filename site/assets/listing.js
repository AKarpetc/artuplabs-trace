/* ArtUp: 3D Models & AR Room — the ONE place for the Shopify App Store listing link.
 *
 * Until Shopify approves the listing, LISTING_LIVE stays false: every element with
 * data-listing-cta keeps its static "Coming to the Shopify App Store" text and links to /shopify/.
 * After approval flip LISTING_LIVE to true (one edit) — the CTAs then point to LISTING_URL and show
 * their data-live-text. <html data-listing-live="true|false"> is set for CSS hooks.
 */
(function () {
  "use strict";
  var LISTING_URL = "https://apps.shopify.com/artup-labs";
  var LISTING_LIVE = false;

  window.ARTUP_LISTING = { url: LISTING_URL, live: LISTING_LIVE };
  document.documentElement.setAttribute("data-listing-live", LISTING_LIVE ? "true" : "false");
  if (!LISTING_LIVE) return;

  function apply() {
    var els = document.querySelectorAll("[data-listing-cta]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === "A") {
        el.setAttribute("href", LISTING_URL);
        el.setAttribute("rel", "noopener");
      }
      var live = el.getAttribute("data-live-text");
      if (live) el.textContent = live;
    }
    var notes = document.querySelectorAll("[data-listing-soon]");
    for (var j = 0; j < notes.length; j++) notes[j].hidden = true;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();
