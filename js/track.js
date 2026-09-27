/*
 * Visitor tracking for the demand test.
 * - Anonymous visitor id (localStorage) and session id (sessionStorage), with an
 *   in-memory fallback when storage is blocked.
 * - UTM + referrer captured on landing and kept for the visit.
 * - Price variant assigned once per visitor and kept for return visits.
 * - Events are POSTed to the Google Apps Script backend, or kept in localStorage in
 *   preview mode (when APPS_SCRIPT_URL is empty).
 * Emails are never logged to the console and never placed in a URL.
 */
(function () {
  "use strict";

  var CFG = window.SITE_CONFIG || {};
  var PREFIX = "fd_"; // "fake door". Not tied to the brand so renaming keeps visitor data.
  var KEYS = {
    visitor: PREFIX + "visitor_id",
    session: PREFIX + "session_id",
    price: PREFIX + "price_variant",
    email: PREFIX + "email",
    attribution: PREFIX + "attribution",
    pricingSeen: PREFIX + "scrolled_pricing"
  };

  /* ---------- Safe storage with in-memory fallback ---------- */

  function makeStore(kind) {
    var memory = {};
    function backend() {
      try {
        var s = window[kind];
        var probe = PREFIX + "probe";
        s.setItem(probe, "1");
        s.removeItem(probe);
        return s;
      } catch (e) {
        return null;
      }
    }
    var real = backend();
    return {
      get: function (key) {
        if (real) {
          try {
            var v = real.getItem(key);
            if (v !== null) return v;
          } catch (e) { /* fall through to memory */ }
        }
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      set: function (key, value) {
        memory[key] = String(value);
        if (real) {
          try { real.setItem(key, String(value)); } catch (e) { /* memory copy kept */ }
        }
      },
      remove: function (key) {
        delete memory[key];
        if (real) {
          try { real.removeItem(key); } catch (e) { /* ignore */ }
        }
      }
    };
  }

  var local = makeStore("localStorage");
  var session = makeStore("sessionStorage");

  /* ---------- Helpers ---------- */

  function randomHex(bytes) {
    var out = "";
    try {
      var arr = new Uint8Array(bytes);
      window.crypto.getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) out += ("0" + arr[i].toString(16)).slice(-2);
      return out;
    } catch (e) {
      for (var j = 0; j < bytes * 2; j++) out += Math.floor(Math.random() * 16).toString(16);
      return out;
    }
  }

  function clip(value, max) {
    if (value === undefined || value === null) return "";
    var s = String(value).trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

  function normalizeEmail(raw) {
    return String(raw || "").trim().toLowerCase();
  }

  function isValidEmail(email) {
    return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
  }

  /* ---------- Identity ---------- */

  function getOrCreate(store, key, prefix) {
    var v = store.get(key);
    if (!v || !/^[a-z]_[0-9a-f]{16,}$/.test(v)) {
      v = prefix + randomHex(12);
      store.set(key, v);
    }
    return v;
  }

  var visitorId = getOrCreate(local, KEYS.visitor, "v_");
  var sessionId = getOrCreate(session, KEYS.session, "s_");

  /* ---------- Attribution (UTM + referrer), kept for the visit ---------- */

  function readAttribution() {
    var stored = null;
    try { stored = JSON.parse(session.get(KEYS.attribution) || "null"); } catch (e) { stored = null; }

    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }
    var fromUrl = {
      utm_source: params ? clip(params.get("utm_source"), 100) : "",
      utm_medium: params ? clip(params.get("utm_medium"), 100) : "",
      utm_campaign: params ? clip(params.get("utm_campaign"), 150) : ""
    };
    var hasUtm = !!(fromUrl.utm_source || fromUrl.utm_medium || fromUrl.utm_campaign);

    if (stored && !hasUtm) return stored;

    // New landing (first page of the visit, or a fresh ad click with UTM tags).
    var referrer = "";
    try {
      if (document.referrer) {
        var ref = new URL(document.referrer);
        // Only keep external referrers, and only origin + path (never query strings).
        if (ref.origin !== window.location.origin) referrer = clip(ref.origin + ref.pathname, 300);
      }
    } catch (e) { referrer = ""; }

    var attr = {
      utm_source: fromUrl.utm_source,
      utm_medium: fromUrl.utm_medium,
      utm_campaign: fromUrl.utm_campaign,
      referrer: referrer || (stored ? stored.referrer : "")
    };
    session.set(KEYS.attribution, JSON.stringify(attr));
    return attr;
  }

  var attribution = readAttribution();

  /* ---------- Price variant ---------- */

  function cleanVariants() {
    var list = Array.isArray(CFG.priceVariants) ? CFG.priceVariants : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = Number(list[i]);
      if (isFinite(n) && n > 0) out.push(n);
    }
    return out.length ? out : [199];
  }

  function assignPrice() {
    var variants = cleanVariants();
    if (variants.length === 1) return variants[0];
    var stored = Number(local.get(KEYS.price));
    if (variants.indexOf(stored) !== -1) return stored;
    var pick = variants[Math.floor(Math.random() * variants.length)];
    try {
      var r = new Uint32Array(1);
      window.crypto.getRandomValues(r);
      pick = variants[r[0] % variants.length];
    } catch (e) { /* Math.random pick kept */ }
    local.set(KEYS.price, pick);
    return pick;
  }

  // Two plans: "membership" (yearly price, the one being price-tested) and "onetime".
  var membershipPrice = assignPrice();
  var oneTimePrice = Number(CFG.oneTimePrice);
  if (!isFinite(oneTimePrice) || oneTimePrice <= 0) oneTimePrice = 299;

  function planPrice(plan) {
    return plan === "onetime" ? oneTimePrice : membershipPrice;
  }

  function formatPrice(n) {
    var symbol = CFG.currencySymbol || "$";
    var rounded = Math.round(n * 100) / 100;
    var text = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2);
    return symbol + text;
  }

  // "$199/year" for the membership, "$299" for the one-time plan.
  function priceLabel(plan) {
    return formatPrice(planPrice(plan)) + (plan === "onetime" ? "" : "/year");
  }

  /* ---------- Device ---------- */

  function deviceType() {
    var ua = navigator.userAgent || "";
    if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return "tablet";
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "tablet"; // iPadOS
    if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
    var shortSide = Math.min(window.screen.width || 0, window.screen.height || 0);
    var touch = (navigator.maxTouchPoints || 0) > 0;
    if (touch && shortSide > 0 && shortSide < 600) return "mobile";
    if (touch && shortSide >= 600 && shortSide <= 1100) return "tablet";
    return "desktop";
  }

  var device = deviceType();

  /* ---------- Email memory ---------- */

  function getEmail() {
    var e = normalizeEmail(local.get(KEYS.email));
    return isValidEmail(e) ? e : "";
  }
  function setEmail(email) { local.set(KEYS.email, normalizeEmail(email)); }
  function clearEmail() { local.remove(KEYS.email); }

  /* ---------- Sending ---------- */

  var endpoint = clip(CFG.APPS_SCRIPT_URL, 500);
  var isPreview = !/^https:\/\//i.test(endpoint);

  function send(evt) {
    if (isPreview) {
      if (window.PreviewBackend) window.PreviewBackend.receive(evt);
      return;
    }
    try {
      fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(evt),
        keepalive: true
      }).catch(function () { /* network errors are ignored; the page must never break */ });
    } catch (e) { /* ignore */ }
  }

  var SURVEY_FIELDS = ["baby_stage", "wanted_feature", "would_buy", "pay_preference", "max_per_year", "updates_opt_in"];

  function track(name, extra) {
    extra = extra || {};
    var plan = extra.plan ? String(extra.plan) : "";
    var evt = {
      event: name,
      client_ts: new Date().toISOString(),
      event_id: "e_" + randomHex(10),
      visitor_id: visitorId,
      session_id: sessionId,
      email: extra.email !== undefined ? normalizeEmail(extra.email) : getEmail(),
      plan: plan,
      price: planPrice(plan || "membership"),
      price_variant: membershipPrice,
      button: clip(extra.button, 40),
      utm_source: attribution.utm_source || "",
      utm_medium: attribution.utm_medium || "",
      utm_campaign: attribution.utm_campaign || "",
      referrer: attribution.referrer || "",
      device: device,
      page_path: clip(window.location.pathname, 200)
    };
    for (var i = 0; i < SURVEY_FIELDS.length; i++) {
      var f = SURVEY_FIELDS[i];
      evt[f] = extra[f] !== undefined ? clip(extra[f], 100) : "";
    }
    send(evt);
    return evt;
  }

  /* Run a callback at most once per session for a given key. */
  function oncePerSession(key, fn) {
    var k = PREFIX + "once_" + key;
    if (session.get(k)) return false;
    session.set(k, "1");
    fn();
    return true;
  }

  window.Tracker = {
    track: track,
    oncePerSession: oncePerSession,
    getEmail: getEmail,
    setEmail: setEmail,
    clearEmail: clearEmail,
    normalizeEmail: normalizeEmail,
    isValidEmail: isValidEmail,
    planPrice: planPrice,
    formatPrice: formatPrice,
    priceLabel: priceLabel,
    membershipPrice: membershipPrice,
    oneTimePrice: oneTimePrice,
    isPreview: isPreview,
    visitorId: visitorId,
    device: device
  };
})();
