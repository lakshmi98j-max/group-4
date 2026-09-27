/*
 * Applies the brand name from config.js across the page, so renaming the product only
 * needs one change (BRAND in config.js). Also fills in the contact email and the year.
 */
(function () {
  "use strict";

  var CFG = window.SITE_CONFIG || {};
  var SOURCE = "Dawn"; // The name written in the HTML files.
  var brand = String(CFG.BRAND || SOURCE).trim() || SOURCE;

  function applyBrand() {
    if (brand === SOURCE) return;
    var pattern = new RegExp("\\b" + SOURCE + "\\b", "g");

    document.title = document.title.replace(pattern, brand);

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode && node.parentNode.nodeName;
      if (parent === "SCRIPT" || parent === "STYLE") continue;
      if (node.nodeValue.indexOf(SOURCE) !== -1) node.nodeValue = node.nodeValue.replace(pattern, brand);
    }

    var attrs = ["aria-label", "alt", "title", "placeholder", "content"];
    var els = document.querySelectorAll("[aria-label], [alt], [title], [placeholder], meta[content]");
    for (var i = 0; i < els.length; i++) {
      for (var j = 0; j < attrs.length; j++) {
        var v = els[i].getAttribute(attrs[j]);
        if (v && v.indexOf(SOURCE) !== -1) els[i].setAttribute(attrs[j], v.replace(pattern, brand));
      }
    }
  }

  function applyExtras() {
    var year = String(new Date().getFullYear());
    var years = document.querySelectorAll("[data-year]");
    for (var i = 0; i < years.length; i++) years[i].textContent = year;

    var contact = String(CFG.CONTACT_EMAIL || "").trim();
    if (contact) {
      var links = document.querySelectorAll("[data-contact-email]");
      for (var j = 0; j < links.length; j++) {
        links[j].textContent = contact;
        if (links[j].tagName === "A") links[j].setAttribute("href", "mailto:" + contact);
      }
    }

    var currency = String(CFG.currencyCode || "").trim();
    if (currency) {
      var cur = document.querySelectorAll("[data-currency]");
      for (var k = 0; k < cur.length; k++) cur[k].textContent = currency;
    }
  }

  function run() {
    applyBrand();
    applyExtras();
  }

  window.Brand = { name: brand };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
