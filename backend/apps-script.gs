/**
 * Demand test backend for the landing page.
 *
 * Paste this whole file into Extensions > Apps Script of a Google Sheet, then deploy it as
 * a Web app (Execute as: Me, Who has access: Anyone). See README.md for the full steps.
 *
 * Sheets (created automatically):
 *   events  - one row per event sent by the site (page_view, scroll_to_pricing, buy_click,
 *             reserve, modal_close).
 *   buyers  - one row per email that reserved a spot, with its Buy click count.
 *
 * Endpoints:
 *   POST (from the site)                  -> records one event.
 *   GET  ?action=count                    -> public totals as JSON.
 *   GET  ?action=stats&key=YOUR_ADMIN_KEY -> events + buyers for admin.html.
 *
 * The admin key lives in Project Settings > Script Properties as ADMIN_KEY.
 * It is never stored in this file or in the GitHub repo.
 */

var EVENTS_SHEET = 'events';
var BUYERS_SHEET = 'buyers';

var EVENT_FIELDS = [
  'server_ts', 'event', 'client_ts', 'event_id', 'visitor_id', 'session_id', 'email',
  'plan', 'price', 'price_variant', 'button', 'utm_source', 'utm_medium', 'utm_campaign',
  'referrer', 'device', 'page_path', 'baby_stage', 'wanted_feature', 'would_buy',
  'updates_opt_in'
];

var BUYER_FIELDS = [
  'email', 'first_click', 'latest_click', 'buy_clicks', 'plan', 'price_shown', 'baby_stage',
  'wanted_feature', 'would_buy', 'updates_opt_in', 'utm_source', 'utm_campaign', 'device',
  'reserved_at', 'visitor_ids'
];

var ALLOWED_EVENTS = {
  page_view: true, scroll_to_pricing: true, buy_click: true, reserve: true, modal_close: true
};

// Longest value kept per field. Anything longer is cut.
var MAX_LENGTH = { email: 254, referrer: 300, page_path: 200, utm_campaign: 150 };
var DEFAULT_MAX_LENGTH = 100;
var MAX_BODY_BYTES = 8000;

var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doPost(e) {
  var raw = e && e.postData && e.postData.contents;
  if (!raw || raw.length > MAX_BODY_BYTES) return json_({ ok: false, error: 'bad_request' });

  var data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  var evt = cleanEvent_(data);
  if (!evt) return json_({ ok: false, error: 'unknown_event' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var events = ensureSheet_(ss, EVENTS_SHEET, EVENT_FIELDS);
    appendObject_(events, evt);

    var touchesBuyer = evt.email && (evt.event === 'reserve' || evt.event === 'buy_click');
    if (touchesBuyer) {
      var buyers = ensureSheet_(ss, BUYERS_SHEET, BUYER_FIELDS);
      upsertBuyer_(events, buyers, evt);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  try { CacheService.getScriptCache().remove('count'); } catch (err) { /* cache is optional */ }
  return json_({ ok: true });
}

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === 'count') {
    return json_(countCached_());
  }

  if (params.action === 'stats') {
    var auth = checkAdminKey_(params.key);
    if (!auth.ok) return json_({ ok: false, error: auth.error });
    return json_(stats_());
  }

  return json_({ ok: true, actions: ['count', 'stats'] });
}

/**
 * Optional: run this once from the Apps Script editor (select "setup" and press Run)
 * to create both sheets and grant permissions before the first real visitor arrives.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, EVENTS_SHEET, EVENT_FIELDS);
  ensureSheet_(ss, BUYERS_SHEET, BUYER_FIELDS);
  var hasKey = !!PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  Logger.log('Sheets ready. ADMIN_KEY is ' + (hasKey ? 'set.' : 'NOT set yet (see README step 3).'));
}

/* ------------------------------------------------------------------ */
/* Input cleaning                                                      */
/* ------------------------------------------------------------------ */

function cleanEvent_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  var name = String(data.event || '');
  if (!ALLOWED_EVENTS[name]) return null;

  var evt = {};
  for (var i = 0; i < EVENT_FIELDS.length; i++) {
    var f = EVENT_FIELDS[i];
    evt[f] = clip_(data[f], MAX_LENGTH[f] || DEFAULT_MAX_LENGTH);
  }

  evt.server_ts = new Date();
  evt.event = name;

  var clientDate = new Date(evt.client_ts);
  evt.client_ts = evt.client_ts && !isNaN(clientDate.getTime()) ? clientDate : '';

  evt.email = normalizeEmail_(evt.email);
  if (!EMAIL_RE.test(evt.email)) evt.email = '';

  evt.price = toNumber_(data.price);
  evt.price_variant = toNumber_(data.price_variant);

  var optIn = String(data.updates_opt_in || '').toLowerCase();
  evt.updates_opt_in = optIn === 'yes' || optIn === 'true' ? 'yes' : (optIn === 'no' || optIn === 'false' ? 'no' : '');

  return evt;
}

function clip_(value, max) {
  if (value === undefined || value === null) return '';
  var s = String(value).trim();
  return s.length > max ? s.substring(0, max) : s;
}

function toNumber_(value) {
  var n = Number(value);
  return value !== '' && value !== null && value !== undefined && isFinite(n) ? n : '';
}

// Cells read back from the sheet may carry the apostrophe added by safeCell_.
function normalizeEmail_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/^'/, '').trim().toLowerCase();
}

function cellText_(value) {
  return String(value === undefined || value === null ? '' : value).replace(/^'/, '');
}

/**
 * Prevents spreadsheet formula injection: a text value starting with = + - @ (or a tab or
 * carriage return) is stored with a leading apostrophe so Sheets treats it as plain text.
 */
function safeCell_(value) {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Returns { sheet, columns: {field: 1-based column}, width }.
 * Creates the sheet and header row if missing, and adds any missing header columns at the
 * end so older sheets keep working after this script is updated.
 */
function ensureSheet_(ss, name, fields) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, fields.length).setValues([fields]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  var columns = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).trim();
    if (h && !columns[h]) columns[h] = c + 1;
  }
  for (var i = 0; i < fields.length; i++) {
    if (!columns[fields[i]]) {
      width += 1;
      sheet.getRange(1, width).setValue(fields[i]).setFontWeight('bold');
      columns[fields[i]] = width;
    }
  }
  return { sheet: sheet, columns: columns, width: width };
}

function rowFromObject_(info, obj) {
  var row = [];
  for (var c = 0; c < info.width; c++) row.push('');
  for (var f in info.columns) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) {
      row[info.columns[f] - 1] = safeCell_(obj[f]);
    }
  }
  return row;
}

function appendObject_(info, obj) {
  info.sheet.appendRow(rowFromObject_(info, obj));
}

function readColumn_(info, field, rowCount) {
  if (rowCount <= 0 || !info.columns[field]) return [];
  var values = info.sheet.getRange(2, info.columns[field], rowCount, 1).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) out.push(values[i][0]);
  return out;
}

function toTime_(value) {
  if (value instanceof Date) return value.getTime();
  var t = new Date(value).getTime();
  return isNaN(t) ? null : t;
}

/* ------------------------------------------------------------------ */
/* Buyers sheet                                                        */
/* ------------------------------------------------------------------ */

/**
 * Creates or updates the buyers row for evt.email.
 * The click count is rebuilt from the events sheet every time, so it is always exact:
 * it counts every buy_click that carries this email, plus every buy_click (including the
 * anonymous ones before they left an email) from any visitor id that has used this email.
 */
function upsertBuyer_(events, buyers, evt) {
  var email = evt.email;
  var eventRows = events.sheet.getLastRow() - 1;
  var names = readColumn_(events, 'event', eventRows);
  var visitors = readColumn_(events, 'visitor_id', eventRows);
  var emails = readColumn_(events, 'email', eventRows);
  var times = readColumn_(events, 'server_ts', eventRows);

  var visitorSet = {};
  var i;
  for (i = 0; i < eventRows; i++) {
    if (normalizeEmail_(emails[i]) === email && visitors[i]) visitorSet[cellText_(visitors[i])] = true;
  }

  var clicks = 0;
  var first = null;
  var latest = null;
  for (i = 0; i < eventRows; i++) {
    if (String(names[i]) !== 'buy_click') continue;
    if (normalizeEmail_(emails[i]) === email || visitorSet[cellText_(visitors[i])]) {
      clicks++;
      var t = toTime_(times[i]);
      if (t !== null) {
        if (first === null || t < first) first = t;
        if (latest === null || t > latest) latest = t;
      }
    }
  }

  // Find this email's row, if any.
  var buyerRows = buyers.sheet.getLastRow() - 1;
  var buyerEmails = readColumn_(buyers, 'email', buyerRows);
  var rowNumber = -1;
  for (i = 0; i < buyerEmails.length; i++) {
    if (normalizeEmail_(buyerEmails[i]) === email) { rowNumber = i + 2; break; }
  }

  var row = {};
  if (rowNumber > 0) {
    var existing = buyers.sheet.getRange(rowNumber, 1, 1, buyers.width).getValues()[0];
    for (var f in buyers.columns) {
      var v = existing[buyers.columns[f] - 1];
      row[f] = typeof v === 'string' ? cellText_(v) : v;
    }
  } else {
    for (var b = 0; b < BUYER_FIELDS.length; b++) row[BUYER_FIELDS[b]] = '';
  }

  row.email = email;
  row.buy_clicks = clicks;
  row.first_click = first === null ? '' : new Date(first);
  row.latest_click = latest === null ? '' : new Date(latest);
  row.visitor_ids = clip_(Object.keys(visitorSet).join(' '), 500);

  if (evt.event === 'reserve') {
    row.plan = evt.plan || row.plan;
    if (evt.price !== '') row.price_shown = evt.price;
    if (evt.baby_stage) row.baby_stage = evt.baby_stage;
    if (evt.wanted_feature) row.wanted_feature = evt.wanted_feature;
    if (evt.would_buy) row.would_buy = evt.would_buy;
    if (evt.updates_opt_in) row.updates_opt_in = evt.updates_opt_in;
    if (evt.utm_source) row.utm_source = evt.utm_source;
    if (evt.utm_campaign) row.utm_campaign = evt.utm_campaign;
    if (evt.device) row.device = evt.device;
    if (!row.reserved_at) row.reserved_at = evt.server_ts;
  } else {
    // A buy_click from someone already on the list: keep their answers, fill any gaps.
    if (!row.plan) row.plan = evt.plan;
    if (row.price_shown === '' || row.price_shown === null) row.price_shown = evt.price;
    if (!row.utm_source) row.utm_source = evt.utm_source;
    if (!row.utm_campaign) row.utm_campaign = evt.utm_campaign;
    if (!row.device) row.device = evt.device;
  }

  var values = rowFromObject_(buyers, row);
  if (rowNumber > 0) {
    buyers.sheet.getRange(rowNumber, 1, 1, buyers.width).setValues([values]);
  } else {
    buyers.sheet.appendRow(values);
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function countCached_() {
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get('count');
    if (hit) return JSON.parse(hit);
  } catch (err) { cache = null; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = { buyClicks: 0, uniqueBuyers: 0, buyersWithEmail: 0 };

  var eventsSheet = ss.getSheetByName(EVENTS_SHEET);
  if (eventsSheet && eventsSheet.getLastRow() > 1) {
    var events = ensureSheet_(ss, EVENTS_SHEET, EVENT_FIELDS);
    var n = events.sheet.getLastRow() - 1;
    var names = readColumn_(events, 'event', n);
    var visitors = readColumn_(events, 'visitor_id', n);
    var seen = {};
    for (var i = 0; i < n; i++) {
      if (String(names[i]) !== 'buy_click') continue;
      result.buyClicks++;
      var v = cellText_(visitors[i]);
      if (v && !seen[v]) { seen[v] = true; result.uniqueBuyers++; }
    }
  }

  var buyersSheet = ss.getSheetByName(BUYERS_SHEET);
  if (buyersSheet) result.buyersWithEmail = Math.max(buyersSheet.getLastRow() - 1, 0);

  if (cache) {
    try { cache.put('count', JSON.stringify(result), 60); } catch (err) { /* ignore */ }
  }
  return result;
}

function checkAdminKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expected) return { ok: false, error: 'admin_key_not_set' };

  // Slow down guessing: after 20 wrong keys in 10 minutes, refuse for a while.
  var cache = null;
  var failures = 0;
  try {
    cache = CacheService.getScriptCache();
    failures = Number(cache.get('admin_failures') || 0);
  } catch (err) { cache = null; }
  if (failures >= 20) return { ok: false, error: 'too_many_attempts' };

  if (safeEquals_(String(key || ''), expected)) return { ok: true };

  if (cache) {
    try { cache.put('admin_failures', String(failures + 1), 600); } catch (err) { /* ignore */ }
  }
  return { ok: false, error: 'unauthorized' };
}

function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sheetToTable_(ss, name, fields, dropFields) {
  var sheet = ss.getSheetByName(name);
  var columns = [];
  for (var i = 0; i < fields.length; i++) {
    if (!dropFields || dropFields.indexOf(fields[i]) === -1) columns.push(fields[i]);
  }
  if (!sheet || sheet.getLastRow() < 2) return { columns: columns, rows: [] };

  var info = ensureSheet_(ss, name, fields);
  var values = info.sheet.getRange(2, 1, info.sheet.getLastRow() - 1, info.width).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var out = [];
    for (var c = 0; c < columns.length; c++) {
      var v = values[r][info.columns[columns[c]] - 1];
      if (v instanceof Date) v = v.toISOString();
      else if (typeof v === 'string') v = cellText_(v);
      out.push(v === undefined ? '' : v);
    }
    rows.push(out);
  }
  return { columns: columns, rows: rows };
}

function stats_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Emails are only needed in the buyers table, so they are left out of the events list.
  var events = sheetToTable_(ss, EVENTS_SHEET, EVENT_FIELDS, ['email']);
  var buyers = sheetToTable_(ss, BUYERS_SHEET, BUYER_FIELDS, null);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    events: events,
    buyers: buyers
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
