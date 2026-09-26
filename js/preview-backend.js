/*
 * Preview backend. Used only when APPS_SCRIPT_URL in config.js is empty.
 * It mirrors backend/apps-script.gs so you can try the full flow (and the admin page)
 * before the Google Sheet exists. Data lives in this browser's localStorage only.
 */
(function () {
  "use strict";

  var EVENTS_KEY = "fd_preview_events";
  var BUYERS_KEY = "fd_preview_buyers";
  var MAX_EVENTS = 3000;

  function read(key) {
    try {
      var v = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function write(key, list) {
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage full or blocked */ }
  }

  function norm(v) {
    return String(v === undefined || v === null ? "" : v).trim().toLowerCase();
  }

  /* Same rules as recomputeBuyer_ in apps-script.gs. */
  function upsertBuyer(events, buyers, evt) {
    var email = norm(evt.email);
    if (!email) return buyers;

    var visitorIds = {};
    events.forEach(function (e) {
      if (norm(e.email) === email && e.visitor_id) visitorIds[e.visitor_id] = true;
    });

    var clicks = 0;
    var first = "";
    var latest = "";
    events.forEach(function (e) {
      if (e.event !== "buy_click") return;
      if (norm(e.email) === email || visitorIds[e.visitor_id]) {
        clicks++;
        if (!first || e.server_ts < first) first = e.server_ts;
        if (!latest || e.server_ts > latest) latest = e.server_ts;
      }
    });

    var row = null;
    for (var i = 0; i < buyers.length; i++) {
      if (norm(buyers[i].email) === email) { row = buyers[i]; break; }
    }
    if (!row) {
      row = {
        email: email, first_click: "", latest_click: "", buy_clicks: 0, plan: "", price_shown: "",
        baby_stage: "", wanted_feature: "", would_buy: "", updates_opt_in: "",
        utm_source: "", utm_campaign: "", device: "", reserved_at: "", visitor_ids: ""
      };
      buyers.push(row);
    }

    row.buy_clicks = clicks;
    row.first_click = first;
    row.latest_click = latest;
    row.visitor_ids = Object.keys(visitorIds).join(" ");

    if (evt.event === "reserve") {
      row.plan = evt.plan || row.plan;
      row.price_shown = evt.price !== "" && evt.price !== undefined ? evt.price : row.price_shown;
      ["baby_stage", "wanted_feature", "would_buy"].forEach(function (f) {
        if (evt[f]) row[f] = evt[f];
      });
      row.updates_opt_in = evt.updates_opt_in || row.updates_opt_in;
      row.utm_source = evt.utm_source || row.utm_source;
      row.utm_campaign = evt.utm_campaign || row.utm_campaign;
      row.device = evt.device || row.device;
      if (!row.reserved_at) row.reserved_at = evt.server_ts;
    } else {
      if (!row.plan) row.plan = evt.plan || "";
      if (row.price_shown === "") row.price_shown = evt.price;
      if (!row.utm_source) row.utm_source = evt.utm_source || "";
      if (!row.utm_campaign) row.utm_campaign = evt.utm_campaign || "";
      if (!row.device) row.device = evt.device || "";
    }
    return buyers;
  }

  function receive(evt) {
    var copy = {};
    for (var k in evt) {
      if (Object.prototype.hasOwnProperty.call(evt, k)) copy[k] = evt[k];
    }
    copy.server_ts = new Date().toISOString();

    var events = read(EVENTS_KEY);
    events.push(copy);
    if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
    write(EVENTS_KEY, events);

    var needsBuyer = copy.event === "reserve" || (copy.event === "buy_click" && copy.email);
    if (needsBuyer) write(BUYERS_KEY, upsertBuyer(events, read(BUYERS_KEY), copy));
  }

  window.PreviewBackend = {
    receive: receive,
    getEvents: function () { return read(EVENTS_KEY); },
    getBuyers: function () { return read(BUYERS_KEY); },
    clear: function () {
      try {
        window.localStorage.removeItem(EVENTS_KEY);
        window.localStorage.removeItem(BUYERS_KEY);
      } catch (e) { /* ignore */ }
    }
  };
})();
