// Runs backend/apps-script.gs against an in-memory mock of Google Sheets. Run: node tests/backend.test.js
const path = require('path');
process.env.GAS_FILE = path.join(__dirname, '..', 'backend', 'apps-script.gs');
const assert = require('assert');
const { createEnv } = require('./gas-mock');
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const base = (o) => Object.assign({ client_ts: new Date().toISOString(), visitor_id: 'v_aaaaaaaaaaaaaaaaaaaaaaaa', session_id: 's_1', email: '', plan: '', price: 249, price_variant: 249, button: '', utm_source: '', utm_medium: '', utm_campaign: '', referrer: '', device: 'mobile', page_path: '/' }, o);

t('creates sheets with header rows', () => {
  const env = createEnv();
  env.post(base({ event: 'page_view' }));
  assert.deepStrictEqual(env.sheets.events.data[0].slice(0, 3), ['server_ts', 'event', 'client_ts']);
  assert.strictEqual(env.sheets.events.frozen, 1);
  env.post(base({ event: 'reserve', email: 'a@b.co', plan: 'band' }));
  assert.strictEqual(env.sheets.buyers.data[0][0], 'email');
});

t('uses a lock for every write and releases it', () => {
  const env = createEnv();
  env.post(base({ event: 'page_view' }));
  env.post(base({ event: 'buy_click', plan: 'band', button: 'hero' }));
  assert.deepStrictEqual(env.lockLog, ['lock', 'release', 'lock', 'release']);
});

t('rejects unknown events, bad JSON and oversized bodies', () => {
  const env = createEnv();
  assert.strictEqual(env.post(base({ event: 'delete_everything' })).error, 'unknown_event');
  assert.strictEqual(env.postRaw('{nope').error, 'bad_json');
  assert.strictEqual(env.postRaw('x'.repeat(9000)).error, 'bad_request');
  assert.strictEqual(env.sheets.events, undefined);
});

t('escapes formula injection and truncates long strings', () => {
  const env = createEnv();
  env.post(base({ event: 'page_view', utm_source: '=HYPERLINK("http://evil","x")', utm_campaign: '+cmd', referrer: '@SUM(1)', utm_medium: '-2+3', page_path: 'x'.repeat(5000) }));
  const head = env.sheets.events.data[0];
  const raw = env.sheets.events.raw[env.sheets.events.raw.length - 1];
  const at = f => raw[head.indexOf(f)];
  assert.strictEqual(at('utm_source'), '\'=HYPERLINK("http://evil","x")');
  assert.strictEqual(at('utm_campaign'), "'+cmd");
  assert.strictEqual(at('referrer'), "'@SUM(1)");
  assert.strictEqual(at('utm_medium'), "'-2+3");
  assert.strictEqual(at('page_path').length, 200);
  assert.strictEqual(typeof at('price'), 'number', 'prices stay numbers');
});

t('normalizes email and ignores invalid ones', () => {
  const env = createEnv();
  env.post(base({ event: 'reserve', email: '  Mixed.Case@Example.COM ' }));
  env.post(base({ event: 'reserve', email: 'not an email', visitor_id: 'v_bbbbbbbbbbbbbbbbbbbbbbbb' }));
  const buyers = env.table('buyers');
  assert.strictEqual(buyers.length, 1);
  assert.strictEqual(buyers[0].email, 'mixed.case@example.com');
});

t('spec scenario: anonymous click, reserve, click again -> 1 row, 2 clicks', () => {
  const env = createEnv();
  env.post(base({ event: 'page_view' }));
  env.post(base({ event: 'buy_click', plan: 'band', button: 'hero' }));
  env.post(base({ event: 'reserve', email: 'p@x.com', plan: 'band', button: 'hero', baby_stage: 'Expecting', would_buy: 'Yes', updates_opt_in: 'no' }));
  env.post(base({ event: 'buy_click', email: 'p@x.com', plan: 'plus', price: 328, button: 'nav' }));
  const b = env.table('buyers');
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].buy_clicks, 2);
  assert.strictEqual(b[0].plan, 'band', 'plan comes from the reserve');
  assert.strictEqual(b[0].baby_stage, 'Expecting');
  assert.strictEqual(b[0].updates_opt_in, 'no');
});

t('clicks from a second device are added once that device reserves with the same email', () => {
  const env = createEnv();
  const A = 'v_aaaaaaaaaaaaaaaaaaaaaaaa', B = 'v_bbbbbbbbbbbbbbbbbbbbbbbb', C = 'v_cccccccccccccccccccccccc';
  env.post(base({ event: 'buy_click', visitor_id: A, plan: 'band' }));
  env.post(base({ event: 'reserve', visitor_id: A, email: 'm@x.com', plan: 'band' }));
  env.post(base({ event: 'buy_click', visitor_id: B, plan: 'plus' }));
  env.post(base({ event: 'buy_click', visitor_id: B, plan: 'plus' }));
  env.post(base({ event: 'buy_click', visitor_id: C, plan: 'plus' })); // someone else
  env.post(base({ event: 'reserve', visitor_id: B, email: 'M@x.com', plan: 'plus', wanted_feature: 'Heart rate' }));
  const b = env.table('buyers');
  assert.strictEqual(b.length, 1, 'still one row per email');
  assert.strictEqual(b[0].buy_clicks, 3);
  assert.strictEqual(b[0].plan, 'plus');
  assert.strictEqual(b[0].wanted_feature, 'Heart rate');
  assert.ok(String(b[0].visitor_ids).includes(A) && String(b[0].visitor_ids).includes(B) && !String(b[0].visitor_ids).includes(C));
});

t('a buy_click with an unknown email still creates the row (e.g. reserve lost)', () => {
  const env = createEnv();
  env.post(base({ event: 'buy_click', email: 'late@x.com', plan: 'band', button: 'nav', utm_source: 'tiktok' }));
  const b = env.table('buyers');
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].buy_clicks, 1);
  assert.strictEqual(b[0].utm_source, 'tiktok');
});

t('emails starting with + survive the escape round trip', () => {
  const env = createEnv();
  env.post(base({ event: 'buy_click', plan: 'band' }));
  env.post(base({ event: 'reserve', email: '+tag@x.com', plan: 'band' }));
  env.post(base({ event: 'buy_click', email: '+tag@x.com', plan: 'band' }));
  const b = env.table('buyers');
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].buy_clicks, 2);
});

t('adds missing header columns to an older sheet', () => {
  const env = createEnv();
  const ss = env.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.insertSheet('events');
  sh.appendRow(['server_ts', 'event', 'visitor_id']);
  env.post(base({ event: 'page_view' }));
  const head = env.sheets.events.data[0];
  assert.ok(head.includes('utm_campaign') && head.includes('email'));
  assert.strictEqual(env.table('events')[0].event, 'page_view');
});

t('count endpoint returns the public totals only', () => {
  const env = createEnv();
  env.post(base({ event: 'buy_click', plan: 'band' }));
  env.post(base({ event: 'buy_click', plan: 'band' }));
  env.post(base({ event: 'buy_click', visitor_id: 'v_bbbbbbbbbbbbbbbbbbbbbbbb', plan: 'band' }));
  env.post(base({ event: 'reserve', email: 'q@x.com' }));
  assert.deepStrictEqual(env.get({ action: 'count' }), { buyClicks: 3, uniqueBuyers: 2, buyersWithEmail: 1 });
});

t('stats requires ADMIN_KEY from Script Properties', () => {
  const none = createEnv({});
  assert.strictEqual(none.get({ action: 'stats', key: 'x' }).error, 'admin_key_not_set');
  const env = createEnv({ ADMIN_KEY: 's3cret-key-123' });
  env.post(base({ event: 'reserve', email: 'r@x.com' }));
  assert.strictEqual(env.get({ action: 'stats' }).error, 'unauthorized');
  assert.strictEqual(env.get({ action: 'stats', key: 's3cret-key-12' }).error, 'unauthorized');
  const ok = env.get({ action: 'stats', key: 's3cret-key-123' });
  assert.strictEqual(ok.ok, true);
  assert.ok(!ok.events.columns.includes('email'), 'emails not sent in the events list');
  assert.strictEqual(ok.buyers.rows[0][ok.buyers.columns.indexOf('email')], 'r@x.com');
  assert.ok(typeof ok.events.rows[0][0] === 'string', 'dates serialised as ISO strings');
});

t('locks out after 20 wrong keys', () => {
  const env = createEnv({ ADMIN_KEY: 'right' });
  for (let i = 0; i < 20; i++) env.get({ action: 'stats', key: 'wrong' + i });
  assert.strictEqual(env.get({ action: 'stats', key: 'right' }).error, 'too_many_attempts');
});

console.log(`\n${passed} backend tests passed`);
