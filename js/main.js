/*
 * Landing page behaviour: prices, navigation, the live phone mockup, the example-night
 * charts, and the Buy / Reserve flow. Tracking itself lives in js/track.js.
 */
(function () {
  "use strict";

  var T = window.Tracker;
  var brand = (window.Brand && window.Brand.name) || "Wren";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function planName(plan) {
    return plan === "plus" ? brand + " Band + " + brand + " Plus" : brand + " Band";
  }

  /* ---------- Prices ---------- */

  function fillPrices() {
    $all('[data-price="band"]').forEach(function (el) { el.textContent = T.formatPrice(T.bandPrice); });
    $all('[data-price="plus"]').forEach(function (el) { el.textContent = T.formatPrice(T.plusPrice); });
  }

  /* ---------- Preview badge ---------- */

  function showPreviewBadge() {
    if (!T.isPreview) return;
    var badge = document.createElement("aside");
    badge.className = "preview-badge";
    badge.setAttribute("aria-label", "Preview mode notice");
    badge.textContent = "Preview mode: data not saved";
    badge.title = "APPS_SCRIPT_URL in config.js is empty, so events stay in this browser only.";
    document.body.appendChild(badge);
  }

  /* ---------- Navigation ---------- */

  function setupNav() {
    var header = $(".nav");
    var toggle = $(".nav__toggle");
    if (!header || !toggle) return;

    function setOpen(open) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    $all(".nav__links a").forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 960) setOpen(false);
    });

    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Temperature unit ---------- */

  var UNIT_KEY = "fd_temp_unit";

  function defaultUnit() {
    try {
      var saved = window.localStorage.getItem(UNIT_KEY);
      if (saved === "c" || saved === "f") return saved;
    } catch (e) { /* ignore */ }
    var lang = (navigator.language || "").toLowerCase();
    return lang === "en-us" ? "f" : "c";
  }

  function applyUnit(unit) {
    $all("[data-temp-c]").forEach(function (el) {
      var c = parseFloat(el.getAttribute("data-temp-c"));
      var dec = parseInt(el.getAttribute("data-temp-dec") || "1", 10);
      var v = unit === "f" ? c * 9 / 5 + 32 : c;
      el.textContent = v.toFixed(dec);
    });
    $all("[data-temp-unit]").forEach(function (el) { el.textContent = unit === "f" ? "°F" : "°C"; });
    $all("[data-unit]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-unit") === unit ? "true" : "false");
    });
  }

  function setupUnits() {
    applyUnit(defaultUnit());
    $all("[data-unit]").forEach(function (b) {
      b.addEventListener("click", function () {
        var unit = b.getAttribute("data-unit");
        applyUnit(unit);
        try { window.localStorage.setItem(UNIT_KEY, unit); } catch (e) { /* ignore */ }
      });
    });
  }

  /* ---------- Phone mockup ---------- */

  var BREATHS_PER_MIN = 34;

  function breathShape(p) {
    // One breath: a quicker inhale, a slower exhale, then a short pause.
    if (p < 0.38) return Math.sin((p / 0.38) * Math.PI / 2);
    if (p < 0.86) return Math.cos(((p - 0.38) / 0.48) * Math.PI / 2);
    return 0;
  }

  function buildWave() {
    var path = $(".wave__path");
    if (!path) return;
    var period = 100; // user units per breath (4 breaths visible in the 400-wide view)
    var d = "";
    for (var x = 0; x <= 800; x += 2) {
      var p = (x % period) / period;
      var y = 50 - breathShape(p) * 38;
      d += (x === 0 ? "M" : "L") + x + " " + y.toFixed(1);
    }
    path.setAttribute("d", d);
    var wave = $("[data-wave]");
    if (wave) wave.style.setProperty("--breath", (60 / BREATHS_PER_MIN).toFixed(2) + "s");
  }

  function startLiveValues() {
    if (reduceMotion) return;
    var els = {
      breath: $('[data-live="breath"]'),
      hr: $('[data-live="hr"]'),
      spo2: $('[data-live="spo2"]'),
      rh: $('[data-live="rh"]'),
      asleep: $('[data-live="asleep"]')
    };
    var minutes = 134;
    var tick = 0;
    function drift(el, min, max, step) {
      if (!el) return;
      var v = parseInt(el.textContent, 10) || min;
      v += Math.round((Math.random() - 0.5) * 2 * step);
      el.textContent = String(Math.max(min, Math.min(max, v)));
    }
    window.setInterval(function () {
      if (document.hidden) return;
      tick++;
      drift(els.hr, 117, 127, 2);
      if (tick % 2 === 0) drift(els.breath, 32, 36, 1);
      if (tick % 5 === 0) drift(els.spo2, 97, 99, 1);
      if (tick % 9 === 0) drift(els.rh, 47, 49, 1);
      if (tick % 25 === 0 && els.asleep) {
        minutes++;
        els.asleep.textContent = Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
      }
    }, 2400);
  }

  /* ---------- Example night charts ---------- */

  var NIGHT_START = 19 * 60 + 40; // 7:40 pm, minutes after midnight
  var NIGHT_LEN = 670; // until 6:50 am
  var SEGMENTS = [
    [0, 14, "awake"], [14, 62, "active"], [62, 148, "quiet"], [148, 181, "active"],
    [181, 240, "quiet"], [240, 262, "awake"], [262, 301, "active"], [301, 383, "quiet"],
    [383, 421, "active"], [421, 445, "quiet"], [445, 461, "awake"], [461, 512, "active"],
    [512, 596, "quiet"], [596, 664, "active"], [664, 670, "awake"]
  ];
  var STAGES = {
    awake: { label: "Awake", lane: 0, breath: 41, hr: 136 },
    active: { label: "Active sleep", lane: 1, breath: 35, hr: 121 },
    quiet: { label: "Quiet sleep", lane: 2, breath: 30, hr: 108 }
  };
  var WAKE_UPS = [240, 445];

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function stageAt(m) {
    for (var i = 0; i < SEGMENTS.length; i++) {
      if (m >= SEGMENTS[i][0] && m < SEGMENTS[i][1]) return SEGMENTS[i][2];
    }
    return "awake";
  }

  var nightData = (function () {
    var rand = mulberry32(20260926);
    var raw = [];
    for (var m = 0; m <= NIGHT_LEN; m += 5) {
      var s = STAGES[stageAt(Math.min(m, NIGHT_LEN - 1))];
      raw.push({
        m: m,
        breath: s.breath + (rand() - 0.5) * 4,
        hr: s.hr + (rand() - 0.5) * 8
      });
    }
    // Smooth with a 5-point moving average so trends read as trends.
    return raw.map(function (p, i) {
      var b = 0, h = 0, n = 0;
      for (var k = -2; k <= 2; k++) {
        var q = raw[i + k];
        if (q) { b += q.breath; h += q.hr; n++; }
      }
      return { m: p.m, breath: b / n, hr: h / n, stage: stageAt(Math.min(p.m, NIGHT_LEN - 1)) };
    });
  })();

  function clockLabel(m) {
    var total = (NIGHT_START + m) % 1440;
    var h = Math.floor(total / 60);
    var min = total % 60;
    var suffix = h >= 12 ? "pm" : "am";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (min ? ":" + (min < 10 ? "0" : "") + min : "") + " " + suffix;
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }
  function text(parent, x, y, str, cls, anchor) {
    var t = el("text", { x: x, y: y, "class": cls || "", "text-anchor": anchor || "start" }, parent);
    t.textContent = str;
    return t;
  }

  function renderNight() {
    var host = document.getElementById("night-charts");
    if (!host) return;
    var width = Math.max(host.clientWidth, 280);
    var narrow = width < 560;
    var padL = narrow ? 44 : 64;
    var padR = 12;
    var plotW = width - padL - padR;
    var x = function (m) { return padL + (m / NIGHT_LEN) * plotW; };

    var laneH = narrow ? 14 : 16;
    var laneGap = 6;
    var hypTop = 34;
    var hypH = laneH * 3 + laneGap * 2;
    var chartH = narrow ? 70 : 84;
    var breathTop = hypTop + hypH + 44;
    var hrTop = breathTop + chartH + 40;
    var axisY = hrTop + chartH + 22;
    var height = axisY + 8;

    host.innerHTML = "";
    var svg = el("svg", { viewBox: "0 0 " + width + " " + height, width: width, height: height, "class": "night-svg" }, host);

    // Legend for the three sleep stages
    var legend = el("g", { "class": "night-legend" }, svg);
    var lx = padL;
    ["awake", "active", "quiet"].forEach(function (key) {
      el("rect", { x: lx, y: 6, width: 10, height: 10, rx: 3, "class": "stage-" + key }, legend);
      var t = text(legend, lx + 15, 15, narrow ? STAGES[key].label.split(" ")[0] : STAGES[key].label, "night-legend__label");
      var w = 0;
      try { w = t.getComputedTextLength(); } catch (e) { w = 0; }
      lx += 15 + (w || STAGES[key].label.length * 6.6) + 18;
    });

    // Hypnogram lanes
    ["awake", "active", "quiet"].forEach(function (key) {
      var lane = STAGES[key].lane;
      var y = hypTop + lane * (laneH + laneGap);
      el("rect", { x: padL, y: y, width: plotW, height: laneH, rx: 4, "class": "lane-bg" }, svg);
      text(svg, padL - 8, y + laneH - 3, narrow ? STAGES[key].label.split(" ")[0] : STAGES[key].label.replace(" sleep", ""), "axis-label", "end");
    });
    SEGMENTS.forEach(function (s) {
      var lane = STAGES[s[2]].lane;
      var y = hypTop + lane * (laneH + laneGap);
      var x0 = x(s[0]) + 1;
      var w = Math.max(x(s[1]) - x(s[0]) - 2, 2);
      el("rect", { x: x0, y: y, width: w, height: laneH, rx: 4, "class": "stage-" + s[2] }, svg);
    });
    WAKE_UPS.forEach(function (m, i) {
      var cx = x(m + 11);
      el("line", { x1: cx, x2: cx, y1: hypTop - 4, y2: axisY - 14, "class": "wake-line" }, svg);
      // First label sits left of its line and the second to the right, so they never collide.
      var label = narrow ? clockLabel(m) : "Woke " + clockLabel(m) + " · feed";
      text(svg, i === 0 ? cx - 5 : cx + 5, hypTop - 6, label, "wake-label", i === 0 ? "end" : "start");
    });

    function trend(top, key, min, max, ticks, title, cls) {
      var y = function (v) { return top + chartH - ((v - min) / (max - min)) * chartH; };
      text(svg, padL, top - 10, title, "chart-title");
      ticks.forEach(function (t) {
        el("line", { x1: padL, x2: padL + plotW, y1: y(t), y2: y(t), "class": "grid" }, svg);
        text(svg, padL - 8, y(t) + 4, String(t), "axis-label", "end");
      });
      var line = "";
      var area = "M" + x(0) + " " + (top + chartH);
      nightData.forEach(function (p, i) {
        var px = x(p.m).toFixed(1);
        var py = y(p[key]).toFixed(1);
        line += (i ? "L" : "M") + px + " " + py;
        area += "L" + px + " " + py;
      });
      area += "L" + x(NIGHT_LEN) + " " + (top + chartH) + "Z";
      el("path", { d: area, "class": "area " + cls }, svg);
      el("path", { d: line, "class": "trend " + cls }, svg);
      return y;
    }

    var yBreath = trend(breathTop, "breath", 24, 48, [30, 40], "Breathing · breaths/min", "trend--breath");
    var yHr = trend(hrTop, "hr", 95, 150, [100, 120, 140], "Heart rate · bpm", "trend--hr");

    // Time axis
    el("line", { x1: padL, x2: padL + plotW, y1: axisY - 12, y2: axisY - 12, "class": "baseline" }, svg);
    var hourTicks = narrow ? [20, 140, 260, 380, 500, 620] : [20, 80, 140, 200, 260, 320, 380, 440, 500, 560, 620];
    hourTicks.forEach(function (m) {
      text(svg, x(m), axisY + 2, clockLabel(m), "axis-label", "middle");
    });

    // Crosshair readout (pointer only; the caption carries the same story in words)
    var cross = el("line", { x1: 0, x2: 0, y1: hypTop - 2, y2: axisY - 12, "class": "crosshair", visibility: "hidden" }, svg);
    var dotB = el("circle", { r: 4.5, "class": "cross-dot trend--breath", visibility: "hidden" }, svg);
    var dotH = el("circle", { r: 4.5, "class": "cross-dot trend--hr", visibility: "hidden" }, svg);
    var tip = document.createElement("div");
    tip.className = "night-tip";
    tip.hidden = true;
    host.appendChild(tip);

    function hide() {
      cross.setAttribute("visibility", "hidden");
      dotB.setAttribute("visibility", "hidden");
      dotH.setAttribute("visibility", "hidden");
      tip.hidden = true;
    }
    svg.addEventListener("pointermove", function (e) {
      var rect = svg.getBoundingClientRect();
      var px = (e.clientX - rect.left) * (width / rect.width);
      if (px < padL || px > padL + plotW) { hide(); return; }
      var m = ((px - padL) / plotW) * NIGHT_LEN;
      var idx = Math.max(0, Math.min(nightData.length - 1, Math.round(m / 5)));
      var p = nightData[idx];
      var cx = x(p.m);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
      dotB.setAttribute("cx", cx); dotB.setAttribute("cy", yBreath(p.breath));
      dotH.setAttribute("cx", cx); dotH.setAttribute("cy", yHr(p.hr));
      cross.setAttribute("visibility", "visible");
      dotB.setAttribute("visibility", "visible");
      dotH.setAttribute("visibility", "visible");

      tip.innerHTML = "";
      var head = document.createElement("p");
      head.className = "night-tip__time";
      head.textContent = clockLabel(p.m) + " · " + STAGES[p.stage].label;
      tip.appendChild(head);
      [["breath", Math.round(p.breath) + " breaths/min"], ["hr", Math.round(p.hr) + " bpm"]].forEach(function (r) {
        var row = document.createElement("p");
        row.className = "night-tip__row night-tip__row--" + r[0];
        var strong = document.createElement("b");
        strong.textContent = r[1];
        row.appendChild(strong);
        tip.appendChild(row);
      });
      tip.hidden = false;
      var left = (cx / width) * rect.width;
      var tipW = tip.offsetWidth;
      var place = left + 12 + tipW > rect.width ? left - tipW - 12 : left + 12;
      tip.style.left = Math.max(0, place) + "px";
      tip.style.top = ((breathTop - 6) / height) * rect.height + "px";
    });
    svg.addEventListener("pointerleave", hide);
  }

  function setupNight() {
    renderNight();
    var host = document.getElementById("night-charts");
    if (!host) return;
    var lastW = host.clientWidth;
    var timer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        if (host.clientWidth !== lastW) {
          lastW = host.clientWidth;
          renderNight();
        }
      }, 150);
    });
  }

  /* ---------- Buy / Reserve flow ---------- */

  function setupReserve() {
    var dialog = document.getElementById("reserve");
    if (!dialog) return;
    var form = $(".reserve-form", dialog);
    var emailInput = $("#r-email", dialog);
    var emailError = $("#r-email-error", dialog);
    var submitBtn = $('button[type="submit"]', form);
    var views = $all("[data-view]", dialog);
    var titles = { form: "reserve-title", done: "done-title", already: "already-title" };
    var state = { plan: "band", price: T.bandPrice, button: "", view: "form", submitted: false, opener: null };
    var supportsDialog = typeof dialog.showModal === "function";

    function showView(name) {
      state.view = name;
      views.forEach(function (v) { v.hidden = v.getAttribute("data-view") !== name; });
      dialog.setAttribute("aria-labelledby", titles[name]);
    }

    function focusView() {
      if (state.view === "form") {
        emailInput.focus();
      } else {
        var title = document.getElementById(titles[state.view]);
        if (title) title.focus();
      }
    }

    function setError(show) {
      emailError.hidden = !show;
      if (show) emailInput.setAttribute("aria-invalid", "true");
      else emailInput.removeAttribute("aria-invalid");
    }

    function openReserve(btn) {
      var plan = btn.getAttribute("data-plan") === "plus" ? "plus" : "band";
      var button = btn.getAttribute("data-button") || "unknown";
      var known = T.getEmail();

      // 1. Record the click first, so the count is right even if nothing else happens.
      T.track("buy_click", { plan: plan, button: button });

      state = { plan: plan, price: T.planPrice(plan), button: button, view: "form", submitted: false, opener: btn };
      $all("[data-modal-price]", dialog).forEach(function (n) { n.textContent = T.formatPrice(state.price); });
      $all("[data-modal-plan]", dialog).forEach(function (n) { n.textContent = planName(plan); });

      if (known) {
        $("[data-known-email]", dialog).textContent = known;
        showView("already");
      } else {
        form.reset();
        setError(false);
        submitBtn.disabled = false;
        showView("form");
      }

      if (supportsDialog) {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
        dialog.classList.add("modal--fallback");
        document.documentElement.classList.add("modal-open");
      }
      focusView();
    }

    function onClosed() {
      if (state.view === "form" && !state.submitted) {
        T.track("modal_close", { plan: state.plan, button: state.button });
      }
      document.documentElement.classList.remove("modal-open");
      state.view = "closed";
      if (state.opener && document.contains(state.opener)) state.opener.focus();
    }

    function closeReserve() {
      if (!dialog.hasAttribute("open")) return;
      if (supportsDialog) {
        dialog.close(); // fires "close", handled below
      } else {
        dialog.removeAttribute("open");
        dialog.classList.remove("modal--fallback");
        onClosed();
      }
    }

    if (supportsDialog) dialog.addEventListener("close", onClosed);

    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-buy]") : null;
      if (btn) {
        e.preventDefault();
        openReserve(btn);
      }
    });

    $all("[data-close]", dialog).forEach(function (b) { b.addEventListener("click", closeReserve); });

    // Clicking the dimmed backdrop closes the modal.
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) closeReserve();
    });
    if (!supportsDialog) {
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && dialog.hasAttribute("open")) closeReserve();
      });
    }

    emailInput.addEventListener("input", function () {
      if (!emailError.hidden && T.isValidEmail(T.normalizeEmail(emailInput.value))) setError(false);
    });

    $("[data-other-email]", dialog).addEventListener("click", function () {
      T.clearEmail();
      form.reset();
      setError(false);
      submitBtn.disabled = false;
      state.submitted = false;
      showView("form");
      focusView();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (state.submitted) return;
      var email = T.normalizeEmail(emailInput.value);
      if (!T.isValidEmail(email)) {
        setError(true);
        emailInput.focus();
        return;
      }
      setError(false);

      function radio(name) {
        var checked = form.querySelector('input[name="' + name + '"]:checked');
        return checked ? checked.value : "";
      }

      state.submitted = true;
      submitBtn.disabled = true;
      T.track("reserve", {
        email: email,
        plan: state.plan,
        button: state.button,
        baby_stage: radio("baby_stage"),
        wanted_feature: form.elements.wanted_feature.value || "",
        would_buy: radio("would_buy"),
        updates_opt_in: form.elements.updates_opt_in.checked ? "yes" : "no"
      });
      T.setEmail(email);
      showView("done");
      focusView();
    });
  }

  /* ---------- Section tracking ---------- */

  function setupPricingWatch() {
    var pricing = document.getElementById("pricing");
    if (!pricing) return;
    function fire() {
      T.oncePerSession("scroll_to_pricing", function () { T.track("scroll_to_pricing"); });
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            fire();
            io.disconnect();
          }
        });
      }, { threshold: 0.25 });
      io.observe(pricing);
    } else {
      var check = function () {
        if (pricing.getBoundingClientRect().top < window.innerHeight * 0.75) {
          fire();
          window.removeEventListener("scroll", check);
        }
      };
      window.addEventListener("scroll", check, { passive: true });
      check();
    }
  }

  /* ---------- Start ---------- */

  function init() {
    fillPrices();
    showPreviewBadge();
    setupNav();
    setupUnits();
    buildWave();
    startLiveValues();
    setupNight();
    setupReserve();
    setupPricingWatch();
    T.track("page_view");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
