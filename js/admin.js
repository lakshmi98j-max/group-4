/*
 * Admin dashboard for the demand test.
 * Live mode: asks for the admin key (kept in localStorage only) and reads
 *   APPS_SCRIPT_URL?action=stats&key=...
 * Preview mode (APPS_SCRIPT_URL empty): reads the events saved in this browser.
 * All values from the data are inserted with textContent, never as HTML.
 */
(function () {
  "use strict";

  var CFG = window.SITE_CONFIG || {};
  var BRAND = (window.Brand && window.Brand.name) || CFG.BRAND || "Wren";
  var ENDPOINT = String(CFG.APPS_SCRIPT_URL || "").trim();
  var PREVIEW = !/^https:\/\//i.test(ENDPOINT);
  var KEY_STORE = "fd_admin_key";
  var DAY = 86400000;

  var state = {
    events: [],
    buyers: [],
    range: "all",
    sortKey: "latest_click",
    sortDir: "desc",
    search: "",
    loadedAt: null
  };

  /* ---------- Small helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function storeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storeSet(key, v) { try { window.localStorage.setItem(key, v); } catch (e) { /* ignore */ } }
  function storeDel(key) { try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  function fmtInt(n) { return Number(n || 0).toLocaleString(); }
  function fmtPct(x, digits) {
    if (!isFinite(x)) return "–";
    return (x * 100).toFixed(digits === undefined ? 1 : digits) + "%";
  }
  function fmtMoney(n) {
    if (n === "" || n === null || n === undefined || !isFinite(Number(n))) return "";
    return (CFG.currencySymbol || "$") + Number(n);
  }
  function eventTime(e) {
    var t = Date.parse(e.server_ts || e.client_ts || "");
    return isNaN(t) ? null : t;
  }
  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function fmtDate(value) {
    var t = Date.parse(value || "");
    if (isNaN(t)) return "";
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function planLabel(p) {
    if (p === "plus") return BRAND + " Band + Plus";
    if (p === "band") return BRAND + " Band";
    return p || "(unknown)";
  }

  /* Wilson score interval for k successes out of n, 95% by default. */
  function wilson(k, n, z) {
    z = z || 1.96;
    if (!n) return { low: 0, high: 0, p: 0 };
    var p = k / n;
    var z2 = z * z;
    var denom = 1 + z2 / n;
    var centre = (p + z2 / (2 * n)) / denom;
    var half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), p: p };
  }

  /* ---------- Data loading ---------- */

  function tableToObjects(table) {
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return [];
    return table.rows.map(function (row) {
      var o = {};
      for (var i = 0; i < table.columns.length; i++) o[table.columns[i]] = row[i];
      return o;
    });
  }

  function loadPreview() {
    var pb = window.PreviewBackend;
    state.events = pb ? pb.getEvents() : [];
    state.buyers = pb ? pb.getBuyers() : [];
    state.loadedAt = new Date();
    return Promise.resolve();
  }

  function loadLive(key) {
    var url = ENDPOINT + (ENDPOINT.indexOf("?") === -1 ? "?" : "&") +
      "action=stats&key=" + encodeURIComponent(key) + "&t=" + Date.now();
    return fetch(url, { method: "GET", cache: "no-store", credentials: "omit", redirect: "follow" })
      .then(function (res) {
        if (!res.ok) throw new Error("http_" + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || data.ok !== true) {
          var err = new Error((data && data.error) || "bad_response");
          err.code = (data && data.error) || "bad_response";
          throw err;
        }
        state.events = tableToObjects(data.events);
        state.buyers = tableToObjects(data.buyers);
        state.loadedAt = new Date();
      });
  }

  var ERROR_TEXT = {
    unauthorized: "That admin key was not accepted. Check it matches ADMIN_KEY in Script Properties.",
    admin_key_not_set: "ADMIN_KEY is not set yet. Add it in Apps Script: Project Settings > Script Properties (README step 3).",
    too_many_attempts: "Too many wrong keys. Wait 10 minutes and try again."
  };

  function load() {
    var content = $("content");
    content.classList.add("is-loading");
    $("load-error").hidden = true;

    var job;
    if (PREVIEW) {
      job = loadPreview();
    } else {
      var key = storeGet(KEY_STORE);
      if (!key) { showKeyForm(""); return Promise.resolve(); }
      job = loadLive(key);
    }

    return job.then(function () {
      content.classList.remove("is-loading");
      render();
    }).catch(function (err) {
      content.classList.remove("is-loading");
      var code = err && (err.code || err.message);
      if (code === "unauthorized" || code === "admin_key_not_set" || code === "too_many_attempts") {
        if (code === "unauthorized") storeDel(KEY_STORE);
        showKeyForm(ERROR_TEXT[code]);
        return;
      }
      var box = $("load-error");
      box.textContent = "Could not load data (" + String(code || "network error") + "). Check APPS_SCRIPT_URL in config.js and that the web app is deployed with access for Anyone, then press Refresh.";
      box.hidden = false;
    });
  }

  /* ---------- Filtering ---------- */

  function rangeStart() {
    var now = new Date();
    if (state.range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (state.range === "7") return now.getTime() - 7 * DAY;
    if (state.range === "30") return now.getTime() - 30 * DAY;
    return null;
  }

  function filteredEvents() {
    var start = rangeStart();
    if (start === null) return state.events.slice();
    return state.events.filter(function (e) {
      var t = eventTime(e);
      return t !== null && t >= start;
    });
  }

  function filteredBuyers() {
    var start = rangeStart();
    if (start === null) return state.buyers.slice();
    return state.buyers.filter(function (b) {
      var times = [b.latest_click, b.reserved_at, b.first_click].map(function (v) { return Date.parse(v || ""); });
      return times.some(function (t) { return !isNaN(t) && t >= start; });
    });
  }

  /* ---------- Metrics ---------- */

  function uniq(list, field) {
    var s = {};
    list.forEach(function (e) { if (e[field]) s[e[field]] = true; });
    return s;
  }
  function size(obj) { return Object.keys(obj).length; }

  function countBy(list, keyFn) {
    var map = {};
    list.forEach(function (e) {
      var k = keyFn(e);
      if (k === null || k === undefined || k === "") return;
      map[k] = (map[k] || 0) + 1;
    });
    return Object.keys(map).map(function (k) { return { label: k, value: map[k] }; })
      .sort(function (a, b) { return b.value - a.value || String(a.label).localeCompare(String(b.label)); });
  }

  function foldTail(rows, max) {
    if (rows.length <= max) return rows;
    var head = rows.slice(0, max - 1);
    var rest = rows.slice(max - 1).reduce(function (s, r) { return s + r.value; }, 0);
    head.push({ label: "Other", value: rest });
    return head;
  }

  /* ---------- Rendering: bars ---------- */

  function renderBars(host, rows, opts) {
    opts = opts || {};
    clear(host);
    if (!rows.length) {
      host.appendChild(make("p", "empty", opts.empty || "No data yet for this date range."));
      return;
    }
    var total = opts.total !== undefined ? opts.total : rows.reduce(function (s, r) { return s + r.value; }, 0);
    var max = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0) || 1;
    var list = make("div", "bars" + (opts.cls ? " " + opts.cls : ""));
    rows.forEach(function (r, i) {
      var row = make("div", "bar-row");
      row.appendChild(make("div", "bar-row__label", r.label));
      var track = make("div", "bar-row__track");
      var bar = make("div", "bar-row__bar");
      bar.setAttribute("data-step", String(i));
      bar.style.width = "calc((100% - 7.5rem) * " + (r.value / max).toFixed(4) + ")";
      track.appendChild(bar);
      var val = make("span", "bar-row__value");
      val.appendChild(make("b", null, fmtInt(r.value)));
      var extra = r.extra !== undefined ? r.extra : (total ? " · " + fmtPct(r.value / total, 0) : "");
      if (extra) val.appendChild(document.createTextNode(extra));
      track.appendChild(val);
      row.appendChild(track);
      list.appendChild(row);
    });
    host.appendChild(list);
    if (opts.note) host.appendChild(make("p", "note", opts.note));
  }

  /* ---------- Rendering: clicks per day (columns) ---------- */

  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs, parent) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  var tooltip = null;
  function showTip(target, lines) {
    if (!tooltip) tooltip = $("tooltip");
    clear(tooltip);
    tooltip.appendChild(make("b", null, lines[0]));
    if (lines[1]) {
      tooltip.appendChild(document.createElement("br"));
      tooltip.appendChild(make("span", null, lines[1]));
    }
    tooltip.hidden = false;
    var r = target.getBoundingClientRect();
    var tw = tooltip.offsetWidth;
    var left = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
    var top = r.top - tooltip.offsetHeight - 8;
    if (top < 8) top = r.bottom + 8;
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }
  function hideTip() { if (tooltip) tooltip.hidden = true; }

  function dayRows(events) {
    var clicks = events.filter(function (e) { return e.event === "buy_click"; });
    var times = events.map(eventTime).filter(function (t) { return t !== null; });
    var start = rangeStart();
    var now = Date.now();
    var first = start !== null ? start : (times.length ? Math.min.apply(null, times) : now);
    var counts = {};
    clicks.forEach(function (e) {
      var t = eventTime(e);
      if (t !== null) counts[dayKey(t)] = (counts[dayKey(t)] || 0) + 1;
    });
    var rows = [];
    var d = new Date(first);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var guard = 0;
    while (d.getTime() <= now && guard < 1000) {
      var k = dayKey(d.getTime());
      rows.push({ key: k, date: new Date(d.getTime()), value: counts[k] || 0 });
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      guard++;
    }
    return rows;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * pow >= v) return steps[i] * pow;
    return 10 * pow;
  }

  function renderDays(host, rows) {
    clear(host);
    if (!rows.length || rows.every(function (r) { return r.value === 0; })) {
      host.appendChild(make("p", "empty", "No buy clicks yet for this date range."));
      host._table = rows;
      return;
    }
    var width = Math.max(host.clientWidth, 280);
    var height = 200;
    var padL = 34, padR = 8, padT = 10, padB = 26;
    var plotW = width - padL - padR;
    var plotH = height - padT - padB;
    var max = niceMax(rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0));
    var band = plotW / rows.length;
    var colW = Math.max(2, Math.min(24, band - 2));
    var y = function (v) { return padT + plotH - (v / max) * plotH; };

    var svg = svgEl("svg", { "class": "cols", viewBox: "0 0 " + width + " " + height, width: width, height: height, role: "img",
      "aria-label": "Buy clicks per day, " + rows.length + " days. Use Show table for exact values." }, host);
    [0, 0.5, 1].forEach(function (f) {
      var v = Math.round(max * f);
      svgEl("line", { x1: padL, x2: width - padR, y1: y(v), y2: y(v), "class": f === 0 ? "base-line" : "grid-line" }, svg);
      var t = svgEl("text", { x: padL - 6, y: y(v) + 4, "text-anchor": "end" }, svg);
      t.textContent = fmtInt(v);
    });

    var labelEvery = Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 64)));
    rows.forEach(function (r, i) {
      var cx = padL + band * i + band / 2;
      var h = Math.max(0, y(0) - y(r.value));
      if (r.value > 0) {
        var x0 = cx - colW / 2;
        var rad = Math.min(4, colW / 2, h);
        // Rounded data end at the top, square at the baseline.
        var d = "M" + x0 + " " + y(0) + "V" + (y(r.value) + rad) +
          "Q" + x0 + " " + y(r.value) + " " + (x0 + rad) + " " + y(r.value) +
          "H" + (x0 + colW - rad) +
          "Q" + (x0 + colW) + " " + y(r.value) + " " + (x0 + colW) + " " + (y(r.value) + rad) +
          "V" + y(0) + "Z";
        var col = svgEl("path", { d: d, "class": "col" }, svg);
        r._col = col;
      }
      if (i % labelEvery === 0) {
        var t = svgEl("text", { x: cx, y: height - 8, "text-anchor": "middle" }, svg);
        t.textContent = r.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
      var hit = svgEl("rect", { x: padL + band * i, y: padT, width: Math.max(band, 1), height: plotH, "class": "hit" }, svg);
      var tipLines = [fmtInt(r.value) + " buy click" + (r.value === 1 ? "" : "s"),
        r.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })];
      hit.addEventListener("pointerenter", function () { if (r._col) r._col.classList.add("is-hover"); showTip(hit, tipLines); });
      hit.addEventListener("pointerleave", function () { if (r._col) r._col.classList.remove("is-hover"); hideTip(); });
    });
    host._table = rows;
  }

  function toggleTable(btn) {
    var host = $(btn.getAttribute("data-table-toggle"));
    var existing = host.parentNode.querySelector(".mini-table-wrap");
    if (existing) {
      existing.parentNode.removeChild(existing);
      btn.textContent = "Show table";
      return;
    }
    var rows = host._table || [];
    var wrap = make("div", "mini-table-wrap");
    var table = make("table", "mini-table");
    var head = make("tr");
    head.appendChild(make("th", null, "Day"));
    head.appendChild(make("th", null, "Buy clicks"));
    var thead = make("thead");
    thead.appendChild(head);
    table.appendChild(thead);
    var body = make("tbody");
    rows.slice().reverse().forEach(function (r) {
      var tr = make("tr");
      tr.appendChild(make("td", null, r.key));
      tr.appendChild(make("td", null, fmtInt(r.value)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    host.parentNode.appendChild(wrap);
    btn.textContent = "Hide table";
  }

  /* ---------- Rendering: price variants with Wilson ranges ---------- */

  function renderPrices(host, events) {
    clear(host);
    var visitors = {};
    var buyers = {};
    events.forEach(function (e) {
      var v = Number(e.price_variant);
      if (!isFinite(v) || !v || !e.visitor_id) return;
      (visitors[v] = visitors[v] || {})[e.visitor_id] = true;
      if (e.event === "buy_click") (buyers[v] = buyers[v] || {})[e.visitor_id] = true;
    });
    var prices = Object.keys(visitors).map(Number).sort(function (a, b) { return a - b; });
    if (!prices.length) {
      host.appendChild(make("p", "empty", "No visits yet for this date range."));
      return;
    }
    var rows = prices.map(function (p) {
      var n = size(visitors[p]);
      var k = size(buyers[p] || {});
      var ci = wilson(k, n);
      return { price: p, n: n, k: k, ci: ci };
    });
    var maxHigh = rows.reduce(function (m, r) { return Math.max(m, r.ci.high); }, 0);
    var scaleMax = Math.min(1, Math.max(0.05, Math.ceil(maxHigh * 20) / 20));

    var list = make("div", "ci-list");
    rows.forEach(function (r) {
      var row = make("div", "ci-row");
      row.appendChild(make("div", "ci-row__price", fmtMoney(r.price)));
      var plot = make("div", "ci-row__plot");
      plot.appendChild(make("div", "ci-row__axis"));
      var range = make("div", "ci-row__range");
      range.style.left = (r.ci.low / scaleMax * 100) + "%";
      range.style.width = Math.max(0.5, (r.ci.high - r.ci.low) / scaleMax * 100) + "%";
      plot.appendChild(range);
      var dot = make("div", "ci-row__dot");
      dot.style.left = (r.ci.p / scaleMax * 100) + "%";
      plot.appendChild(dot);
      row.appendChild(plot);
      var txt = make("p", "ci-row__text");
      txt.appendChild(make("b", null, fmtPct(r.ci.p)));
      txt.appendChild(document.createTextNode(" · " + fmtInt(r.k) + " of " + fmtInt(r.n) + " visitors · range " +
        fmtPct(r.ci.low) + " to " + fmtPct(r.ci.high)));
      row.appendChild(txt);
      list.appendChild(row);
    });
    host.appendChild(list);
    var scale = make("div", "ci-scale");
    scale.appendChild(make("span", null, "0%"));
    scale.appendChild(make("span", null, fmtPct(scaleMax / 2, 1)));
    scale.appendChild(make("span", null, fmtPct(scaleMax, 0)));
    host.appendChild(scale);

    var smallest = rows.reduce(function (m, r) { return Math.min(m, r.n); }, Infinity);
    if (rows.length === 1) {
      host.appendChild(make("p", "note", "Only one price has been shown in this range, so there is nothing to compare yet."));
    } else if (smallest < 100) {
      host.appendChild(make("p", "note", "Small sample: at least one price has fewer than 100 visitors. Treat differences as a hint, not a result, until the ranges stop overlapping."));
    }
  }

  /* ---------- Rendering: buyers table ---------- */

  var COLUMNS = [
    { key: "email", label: "Email" },
    { key: "buy_clicks", label: "Clicks", num: true },
    { key: "plan", label: "Plan", fmt: planLabel },
    { key: "price_shown", label: "Price", num: true, fmt: fmtMoney },
    { key: "first_click", label: "First click", fmt: fmtDate, time: true },
    { key: "utm_source", label: "Source", fmt: function (v) { return v || "(no UTM)"; } },
    { key: "baby_stage", label: "Baby stage" },
    { key: "wanted_feature", label: "Most wanted feature", wrap: true },
    { key: "would_buy", label: "Would buy at price", wrap: true },
    { key: "updates_opt_in", label: "Updates opt-in" }
  ];
  var CSV_FIELDS = ["email", "buy_clicks", "plan", "price_shown", "first_click", "latest_click", "reserved_at",
    "utm_source", "utm_campaign", "device", "baby_stage", "wanted_feature", "would_buy", "updates_opt_in"];

  function buyerRowsForTable() {
    var q = state.search.trim().toLowerCase();
    var rows = filteredBuyers();
    if (q) {
      rows = rows.filter(function (b) {
        return CSV_FIELDS.some(function (f) { return String(b[f] === undefined ? "" : b[f]).toLowerCase().indexOf(q) !== -1; });
      });
    }
    var col = null;
    for (var i = 0; i < COLUMNS.length; i++) if (COLUMNS[i].key === state.sortKey) col = COLUMNS[i];
    var dir = state.sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var va = a[state.sortKey], vb = b[state.sortKey];
      if ((col && col.time) || state.sortKey === "latest_click") {
        va = Date.parse(va || "") || 0; vb = Date.parse(vb || "") || 0;
      } else if (col && col.num) {
        va = Number(va) || 0; vb = Number(vb) || 0;
      } else {
        va = String(va || "").toLowerCase(); vb = String(vb || "").toLowerCase();
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return rows;
  }

  function renderBuyersTable() {
    var table = $("buyers-table");
    var headRow = table.querySelector("thead tr");
    var body = table.querySelector("tbody");
    clear(headRow);
    clear(body);

    COLUMNS.forEach(function (c) {
      var th = make("th", c.num ? "num" : "");
      th.setAttribute("scope", "col");
      if (state.sortKey === c.key) th.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
      var b = make("button", null, c.label);
      b.type = "button";
      b.addEventListener("click", function () {
        if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = c.key; state.sortDir = c.num || c.time ? "desc" : "asc"; }
        renderBuyersTable();
      });
      th.appendChild(b);
      headRow.appendChild(th);
    });

    var rows = buyerRowsForTable();
    rows.forEach(function (r) {
      var tr = make("tr");
      COLUMNS.forEach(function (c) {
        var v = r[c.key];
        var shown = c.fmt ? c.fmt(v) : (v === undefined || v === null ? "" : v);
        var td = make("td", (c.num ? "num" : "") + (c.wrap ? " wrap" : ""), c.key === "buy_clicks" ? fmtInt(v) : shown);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if (!rows.length) {
      var tr = make("tr");
      var td = make("td", "empty", state.search ? "No buyers match your search." : "No one has reserved with an email in this date range yet.");
      td.colSpan = COLUMNS.length;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    $("buyers-count").textContent = fmtInt(rows.length) + " " + (rows.length === 1 ? "person" : "people") +
      (state.search ? " matching your search" : "") + ". Click a column name to sort.";
  }

  function csvCell(v) {
    var s = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keeps spreadsheet apps from running it as a formula
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv() {
    var rows = buyerRowsForTable();
    var lines = [CSV_FIELDS.join(",")];
    rows.forEach(function (r) {
      lines.push(CSV_FIELDS.map(function (f) { return csvCell(r[f]); }).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "buyers-" + dayKey(Date.now()) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.parentNode.removeChild(a);
    }, 0);
  }

  /* ---------- Main render ---------- */

  function render() {
    $("dashboard").hidden = false;
    $("key-card").hidden = true;

    var events = filteredEvents();
    var buyers = filteredBuyers();
    var visitors = uniq(events, "visitor_id");
    var clicks = events.filter(function (e) { return e.event === "buy_click"; });
    var clickers = uniq(clicks, "visitor_id");
    var nVisitors = size(visitors);
    var nClickers = size(clickers);

    // Anyone who ever reserved (all time) counts as having left an email.
    var reservedEver = uniq(state.events.filter(function (e) { return e.event === "reserve"; }), "visitor_id");
    var noEmail = Object.keys(clickers).filter(function (v) { return !reservedEver[v]; }).length;

    var rate = nVisitors ? nClickers / nVisitors : NaN;
    var ci = wilson(nClickers, nVisitors);
    $("rate-value").textContent = nVisitors ? fmtPct(rate) : "–";
    $("rate-detail").textContent = nVisitors
      ? fmtInt(nClickers) + " of " + fmtInt(nVisitors) + " unique visitors clicked a Buy button. 95% range: " +
        fmtPct(ci.low) + " to " + fmtPct(ci.high) + "."
      : "No visits recorded in this date range yet.";

    $("t-visitors").textContent = fmtInt(nVisitors);
    $("t-clicks").textContent = fmtInt(clicks.length);
    $("t-buyers").textContent = fmtInt(nClickers);
    $("t-emails").textContent = fmtInt(buyers.length);
    $("t-noemail").textContent = fmtInt(noEmail);

    renderDays($("c-days"), dayRows(events));
    var openTable = document.querySelector(".mini-table-wrap");
    if (openTable) {
      openTable.parentNode.removeChild(openTable);
      toggleTable(document.querySelector('[data-table-toggle="c-days"]'));
    }

    var scrolled = size(uniq(events.filter(function (e) { return e.event === "scroll_to_pricing"; }), "visitor_id"));
    var reserved = size(uniq(events.filter(function (e) { return e.event === "reserve"; }), "visitor_id"));
    var steps = [
      { label: "Visited", value: nVisitors },
      { label: "Scrolled to pricing", value: scrolled },
      { label: "Clicked Buy", value: nClickers },
      { label: "Reserved with email", value: reserved }
    ];
    steps.forEach(function (s, i) {
      var ofAll = nVisitors ? fmtPct(s.value / nVisitors, 1) : "–";
      s.extra = i === 0 ? " · 100%" : " · " + ofAll + " of visitors";
    });
    renderBars($("c-funnel"), nVisitors ? steps : [], { cls: "funnel", empty: "No visits recorded in this date range yet." });

    renderPrices($("c-price"), events);

    renderBars($("c-plan"), countBy(clicks, function (e) { return planLabel(e.plan); }));
    renderBars($("c-button"), countBy(clicks, function (e) { return e.button || "(unknown)"; }));
    renderBars($("c-source"), foldTail(countBy(clicks, function (e) { return e.utm_source || "(no UTM)"; }), 8));
    renderBars($("c-device"), countBy(clicks, function (e) { return e.device || "(unknown)"; }));

    function survey(field) {
      var answered = buyers.filter(function (b) { return b[field]; }).length;
      var rows = foldTail(countBy(buyers, function (b) { return b[field]; }), 8);
      return { rows: rows, note: buyers.length ? fmtInt(answered) + " of " + fmtInt(buyers.length) + " answered." : "" };
    }
    ["baby_stage", "wanted_feature", "would_buy"].forEach(function (f, i) {
      var host = $(["c-stage", "c-feature", "c-would"][i]);
      var s = survey(f);
      renderBars(host, s.rows, { note: s.rows.length ? s.note : "", empty: "No answers yet." });
    });

    renderBuyersTable();

    $("updated").textContent = state.loadedAt ? "Updated " + state.loadedAt.toLocaleTimeString() : "";
  }

  /* ---------- Key form and controls ---------- */

  function showKeyForm(message) {
    $("dashboard").hidden = true;
    $("key-card").hidden = false;
    $("forget-key").hidden = true;
    var err = $("key-error");
    err.textContent = message || "";
    err.hidden = !message;
    $("admin-key").value = "";
    $("admin-key").focus();
  }

  function init() {
    var mode = $("mode-label");
    clear(mode);
    var pill = make("span", "mode-pill" + (PREVIEW ? "" : " mode-pill--live"),
      PREVIEW ? "Preview mode: showing data saved in this browser only" : "Live data from Google Sheets");
    mode.appendChild(pill);

    if (PREVIEW) {
      $("clear-preview").hidden = false;
      $("clear-preview").addEventListener("click", function () {
        if (window.confirm("Delete all preview events and buyers saved in this browser?")) {
          if (window.PreviewBackend) window.PreviewBackend.clear();
          load();
        }
      });
    } else if (storeGet(KEY_STORE)) {
      $("forget-key").hidden = false;
    }

    $("forget-key").addEventListener("click", function () {
      storeDel(KEY_STORE);
      state.events = [];
      state.buyers = [];
      showKeyForm("Key removed from this browser.");
    });

    $("key-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var key = $("admin-key").value.trim();
      if (!key) return;
      storeSet(KEY_STORE, key);
      $("forget-key").hidden = false;
      $("dashboard").hidden = false;
      $("key-card").hidden = true;
      load();
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-range]"), function (b) {
      b.addEventListener("click", function () {
        state.range = b.getAttribute("data-range");
        Array.prototype.forEach.call(document.querySelectorAll("[data-range]"), function (o) {
          o.setAttribute("aria-checked", o === b ? "true" : "false");
        });
        render();
      });
    });

    $("refresh").addEventListener("click", load);
    $("buyer-search").addEventListener("input", function (e) {
      state.search = e.target.value;
      renderBuyersTable();
    });
    $("download-csv").addEventListener("click", downloadCsv);
    Array.prototype.forEach.call(document.querySelectorAll("[data-table-toggle]"), function (b) {
      b.addEventListener("click", function () { toggleTable(b); });
    });

    var lastW = window.innerWidth;
    var t = null;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (window.innerWidth !== lastW && !$("dashboard").hidden) {
          lastW = window.innerWidth;
          renderDays($("c-days"), dayRows(filteredEvents()));
        }
      }, 150);
    });

    if (PREVIEW || storeGet(KEY_STORE)) {
      $("dashboard").hidden = false;
      load();
    } else {
      showKeyForm("");
    }
  }

  // Exposed for tests.
  window.AdminMath = { wilson: wilson };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
