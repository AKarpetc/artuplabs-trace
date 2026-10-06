/* ArtUp AR XR — shared RU/EN language switch for the product pages.
 *
 * Contract (the demo app follows the same one):
 *   - localStorage key "artup-lang", values "ru" | "en".
 *   - Resolution: ?lang= in the URL (persisted) -> stored value -> "en".
 *     English is the default everywhere; Russian only after the user switches (or ?lang=ru).
 *   - Links into the demo ("demo/...") carry the current language as ?lang=.
 *
 * A page defines its dictionary before loading this file:
 *   window.ARTUP_I18N = { ru: {...}, en: {...} };
 * and marks elements with
 *   data-i18n="key"                      -> textContent
 *   data-i18n-html="key"                 -> innerHTML (trusted strings only)
 *   data-i18n-attr="aria-label:key;title:key"
 * Keys "meta.title" and "meta.description" switch the document title and meta description.
 * The text in the HTML (Russian on the AR XR pages, English on the company pages) is the fallback:
 * a key missing from a dictionary keeps the original markup.
 *
 * API: window.ArtupLang = { get(), set(lang), onChange(cb) }.
 */
(function () {
  "use strict";

  var KEY = "artup-lang";
  var SUPPORTED = { ru: true, en: true };
  var listeners = [];
  var current = null;

  function valid(v) { return SUPPORTED[v] === true ? v : null; }

  function fromUrl() {
    try { return valid(new URLSearchParams(location.search).get("lang")); } catch (e) { return null; }
  }
  function fromStorage() {
    try { return valid(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function store(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) { /* storage blocked */ }
  }

  function dictionary(lang) {
    var all = window.ARTUP_I18N || {};
    return all[lang] || {};
  }
  function pick(dict, key, original) {
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : original;
  }

  // Originals (the page's own markup) are captured once, before the first translation.
  function original(el, slot, read) {
    var cache = el.__artupI18n || (el.__artupI18n = {});
    if (!(slot in cache)) cache[slot] = read();
    return cache[slot];
  }

  var metaDescription = document.querySelector('meta[name="description"]');
  var originalTitle = document.title;
  var originalDescription = metaDescription ? metaDescription.getAttribute("content") : "";

  function translate(lang) {
    var dict = dictionary(lang);
    var i, el, key;

    var texts = document.querySelectorAll("[data-i18n]");
    for (i = 0; i < texts.length; i++) {
      el = texts[i];
      key = el.getAttribute("data-i18n");
      el.textContent = pick(dict, key, original(el, "text", function () { return el.textContent; }));
    }

    var htmls = document.querySelectorAll("[data-i18n-html]");
    for (i = 0; i < htmls.length; i++) {
      el = htmls[i];
      key = el.getAttribute("data-i18n-html");
      el.innerHTML = pick(dict, key, original(el, "html", function () { return el.innerHTML; }));
    }

    var attrs = document.querySelectorAll("[data-i18n-attr]");
    for (i = 0; i < attrs.length; i++) {
      el = attrs[i];
      var pairs = el.getAttribute("data-i18n-attr").split(";");
      for (var j = 0; j < pairs.length; j++) {
        var parts = pairs[j].split(":");
        if (parts.length < 2) continue;
        var attr = parts[0].trim();
        key = parts.slice(1).join(":").trim();
        var orig = original(el, "attr:" + attr, function () { return el.getAttribute(attr); });
        var value = pick(dict, key, orig);
        if (value === null) el.removeAttribute(attr); else el.setAttribute(attr, value);
      }
    }

    document.title = pick(dict, "meta.title", originalTitle);
    if (metaDescription) metaDescription.setAttribute("content", pick(dict, "meta.description", originalDescription));
  }

  // Appends lang=<current> to every link into the demo, keeping the existing query and hash.
  function tagDemoLinks(lang) {
    var links = document.querySelectorAll('a[href^="demo/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      var hash = "";
      var h = href.indexOf("#");
      if (h >= 0) { hash = href.slice(h); href = href.slice(0, h); }
      var q = href.indexOf("?");
      var path = q >= 0 ? href.slice(0, q) : href;
      var params = q >= 0 ? href.slice(q + 1).split("&").filter(function (p) {
        return p && p.indexOf("lang=") !== 0;
      }) : [];
      params.push("lang=" + lang);
      links[i].setAttribute("href", path + "?" + params.join("&") + hash);
    }
  }

  function syncToggle(lang) {
    var buttons = document.querySelectorAll("[data-lang-set]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-lang-set") === lang ? "true" : "false");
    }
  }

  function apply(lang) {
    current = lang;
    document.documentElement.lang = lang;
    translate(lang);
    tagDemoLinks(lang);
    syncToggle(lang);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) { /* a listener must not break the switch */ }
    }
  }

  function set(lang) {
    lang = valid(lang);
    if (!lang) return;
    store(lang);
    if (fromUrl()) {
      try {
        var url = new URL(location.href);
        url.searchParams.set("lang", lang);
        history.replaceState(history.state, "", url);
      } catch (e) { /* old browser: keep the URL */ }
    }
    if (lang !== current) apply(lang);
  }

  var initial = fromUrl();
  if (initial) store(initial);
  else initial = fromStorage() || "en";

  window.ArtupLang = {
    get: function () { return current; },
    set: set,
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); }
  };

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lang-set]");
    if (b) set(b.getAttribute("data-lang-set"));
  });

  apply(initial);
})();
