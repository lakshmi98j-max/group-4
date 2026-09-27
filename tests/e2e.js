// End-to-end test of the buy flow in a real browser (needs Playwright).
// Start a local server in the repo root first, for example: npx http-server -p 8080
// Then run: node tests/e2e.js
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const assert = require('assert');
process.env.GAS_FILE = process.env.GAS_FILE || path.join(__dirname, '..', 'backend', 'apps-script.gs');
const { createEnv } = require('./gas-mock');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const EMAIL_TYPED = '  Test.Parent@Example.COM ';
const EMAIL = 'test.parent@example.com';
const log = (...a) => console.log(...a);

async function runFlow(page, consoleLines) {
  // 1. Page view (on load) and scroll to pricing
  await page.goto(BASE + '/index.html?utm_source=instagram&utm_medium=paid&utm_campaign=launch1', { waitUntil: 'networkidle' });
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('#top').scrollIntoViewIfNeeded();

  // 2. Anonymous buy click from the hero
  await page.click('[data-buy][data-button="hero"]');
  await page.waitForSelector('#reserve[open]');
  assert.strictEqual(await page.isVisible('[data-view="form"]'), true, 'form view shown');
  const text = await page.textContent('[data-view="form"] .modal__text');
  assert.ok(/Reserve yours at \$\d+\/year and we'll email you first when orders open\. No payment now, no card needed\./.test(text), 'modal copy: ' + text);
  assert.ok((await page.textContent('[data-modal-plan]')).includes('Membership'), 'hero Buy is the membership plan');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'r-email', 'focus moves to email field');

  // Invalid email is rejected
  await page.fill('#r-email', 'not-an-email');
  await page.click('.reserve-form button[type=submit]');
  assert.strictEqual(await page.isVisible('#r-email-error'), true, 'error shown for invalid email');
  assert.strictEqual(await page.getAttribute('#r-email', 'aria-invalid'), 'true');

  // 3. Reserve with an email and survey answers
  await page.fill('#r-email', EMAIL_TYPED);
  await page.check('input[name=baby_stage][value="0-3 months"]', { force: true });
  await page.selectOption('#r-feature', 'Breathing rate');
  await page.check('input[name=would_buy][value="Yes"]', { force: true });
  await page.check('input[name=pay_preference][value="Yearly membership"]', { force: true });
  await page.selectOption('#r-max', '$200 to $249');
  await page.check('#r-updates');
  await page.click('.reserve-form button[type=submit]');
  await page.waitForSelector('[data-view="done"]:not([hidden])');
  const done = (await page.textContent('[data-view="done"]')).replace(/\s+/g, ' ').trim();
  assert.ok(done.includes("You're on the list! Dawn isn't on sale yet, and you haven't been charged. We'll email you when pre-orders open."), done);
  await page.click('[data-view="done"] [data-close]');
  await page.waitForSelector('#reserve:not([open])', { state: 'attached' });

  // 4. Second buy click by the same visitor (pricing, Plus plan)
  await page.click('[data-buy][data-plan="onetime"]');
  await page.waitForSelector('#reserve[open]');
  const already = (await page.textContent('[data-view="already"] .modal__title')).replace(/\s+/g, ' ').trim();
  assert.strictEqual(already, "You're already on the list as " + EMAIL);
  assert.strictEqual(await page.isVisible('[data-view="form"]'), false, 'form hidden for known visitor');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#reserve:not([open])', { state: 'attached' });

  // No email anywhere in console output
  assert.ok(!consoleLines.some(l => l.toLowerCase().includes('example.com')), 'email never logged');
}

async function modalCloseFlow(page) {
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.click('[data-buy][data-button="nav"]');
  await page.waitForSelector('#reserve[open]');
  await page.click('.modal__close');
  await page.waitForSelector('#reserve:not([open])', { state: 'attached' });
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- Preview mode ---------------- */
  log('\n=== PREVIEW MODE (APPS_SCRIPT_URL empty) ===');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', m => consoleLines.push(m.text()));
  page.on('pageerror', e => { throw e; });
  let networkPosts = 0;
  page.on('request', r => { if (r.method() === 'POST') networkPosts++; });

  await runFlow(page, consoleLines);
  assert.strictEqual(await page.isVisible('.preview-badge'), true, 'preview badge visible');
  assert.strictEqual(networkPosts, 0, 'no network POSTs in preview mode');

  const stored = await page.evaluate(() => ({
    events: JSON.parse(localStorage.getItem('fd_preview_events')),
    buyers: JSON.parse(localStorage.getItem('fd_preview_buyers')),
    email: localStorage.getItem('fd_email')
  }));
  log('Events recorded:', stored.events.map(e => `${e.event}${e.button ? '(' + e.button + ')' : ''}${e.email ? ' [email]' : ''}`).join(', '));
  const names = stored.events.map(e => e.event);
  assert.deepStrictEqual(names, ['page_view', 'scroll_to_pricing', 'buy_click', 'reserve', 'buy_click']);
  const ev = stored.events;
  const required = ['event', 'client_ts', 'visitor_id', 'session_id', 'email', 'plan', 'price', 'price_variant', 'button',
    'utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'device', 'page_path'];
  ev.forEach(e => required.forEach(f => assert.ok(f in e, `${e.event} has ${f}`)));
  assert.ok(ev.every(e => e.visitor_id === ev[0].visitor_id), 'same visitor id');
  assert.ok(ev.every(e => e.utm_source === 'instagram' && e.utm_campaign === 'launch1'), 'utm kept for visit');
  assert.ok(ev.every(e => e.device === 'mobile'), 'device mobile');
  assert.strictEqual(ev[2].email, '', 'first buy click is anonymous');
  assert.strictEqual(ev[2].button, 'hero');
  assert.strictEqual(ev[3].email, EMAIL, 'reserve email normalized');
  assert.strictEqual(ev[3].baby_stage, '0-3 months');
  assert.strictEqual(ev[3].pay_preference, 'Yearly membership');
  assert.strictEqual(ev[3].max_per_year, '$200 to $249');
  assert.strictEqual(ev[3].plan, 'membership');
  assert.strictEqual(ev[3].price, ev[3].price_variant, 'membership price = the yearly price variant');
  assert.strictEqual(ev[3].updates_opt_in, 'yes');
  assert.strictEqual(ev[4].email, EMAIL, 'second buy click carries email');
  assert.strictEqual(ev[4].plan, 'onetime');
  assert.strictEqual(ev[4].price, 299, 'one-time price from config');
  assert.ok([149, 199, 249].includes(ev[4].price_variant), 'price variant from config');
  log('Buyers data (preview):');
  console.table(stored.buyers.map(b => ({ email: b.email, buy_clicks: b.buy_clicks, plan: b.plan, price_shown: b.price_shown, baby_stage: b.baby_stage, wanted_feature: b.wanted_feature, would_buy: b.would_buy, pay_preference: b.pay_preference, max_per_year: b.max_per_year, updates_opt_in: b.updates_opt_in, utm_source: b.utm_source, device: b.device })));
  assert.strictEqual(stored.buyers.length, 1, 'one buyer row');
  assert.strictEqual(stored.buyers[0].email, EMAIL);
  assert.strictEqual(stored.buyers[0].buy_clicks, 2, 'two clicks');
  assert.strictEqual(stored.buyers[0].max_per_year, '$200 to $249');

  // Reload: price variant and visitor id persist, scroll_to_pricing not repeated in the same session
  const before = stored.events[0];
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fd_preview_events')));
  const last = after[after.length - 1];
  assert.strictEqual(last.event, 'page_view');
  assert.strictEqual(last.visitor_id, before.visitor_id);
  assert.strictEqual(last.price_variant, before.price_variant, 'price kept on return');
  assert.strictEqual(last.email, EMAIL, 'known email attached to later events');
  assert.strictEqual(after.filter(e => e.event === 'scroll_to_pricing').length, 1, 'scroll_to_pricing once per session');

  // Admin page in preview mode, same browser
  const admin = await ctx.newPage();
  await admin.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  await admin.waitForSelector('#buyers-table tbody tr');
  const tiles = await admin.evaluate(() => ['t-visitors', 't-clicks', 't-buyers', 't-emails', 't-noemail', 'rate-value']
    .map(id => document.getElementById(id).textContent));
  log('Admin tiles [visitors, clicks, buyers, with email, no email, rate]:', tiles.join(' | '));
  assert.deepStrictEqual(tiles, ['1', '2', '1', '1', '0', '100.0%']);
  const row = await admin.$$eval('#buyers-table tbody tr td', tds => tds.map(t => t.textContent));
  log('Admin buyers row:', row.join(' | '));
  assert.strictEqual(row[0], EMAIL);
  assert.strictEqual(row[1], '2');
  const tc = await admin.evaluate(() => ['tc-agree', 'tc-customers', 'tc-status'].map(id => document.getElementById(id).textContent));
  log('Admin test card [agreed $200+/yr, customers, status]:', tc.join(' | '));
  assert.strictEqual(tc[0], '1 of 50', 'the reservation said $200 to $249, so it counts as agreeing');
  assert.strictEqual(tc[1], '1 of 50');
  // Willingness-to-pay rule on the test card, with edge cases added to the preview buyers.
  await admin.evaluate(() => {
    const extra = [
      { email: 'a@x.com', plan: 'membership', price_shown: 199, would_buy: 'Yes', max_per_year: '' },                     // agrees (reserved at $199/yr)
      { email: 'b@x.com', plan: 'membership', price_shown: 249, would_buy: 'Maybe at a lower price', max_per_year: '' },  // doubts the price: not counted
      { email: 'c@x.com', plan: 'onetime', price_shown: 299, would_buy: '', max_per_year: '$250 or more' },                // agrees (said $250+/yr)
      { email: 'd@x.com', plan: 'membership', price_shown: 149, would_buy: 'Yes', max_per_year: '$150 to $199' }           // below $200: not counted
    ].map(b => Object.assign({ buy_clicks: 1, first_click: new Date().toISOString(), latest_click: new Date().toISOString() }, b));
    const cur = JSON.parse(localStorage.getItem('fd_preview_buyers'));
    localStorage.setItem('fd_preview_buyers', JSON.stringify(cur.concat(extra)));
  });
  await admin.click('#refresh');
  await admin.waitForTimeout(200);
  const agreed = await admin.textContent('#tc-agree');
  log('Test card with 4 edge-case reservations added:', agreed, '|', await admin.textContent('#tc-customers'));
  assert.strictEqual(agreed, '3 of 50', 'original + a@x (reserved at $199/yr) + c@x (said $250+/yr)');
  await admin.screenshot({ path: path.join(os.tmpdir(), 'admin-preview.png'), fullPage: true });
  await ctx.close();

  // Modal close by a second (fresh) visitor
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  await modalCloseFlow(p2);
  const ev2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('fd_preview_events')));
  log('Second visitor events:', ev2.map(e => e.event + (e.button ? '(' + e.button + ')' : '')).join(', '));
  assert.deepStrictEqual(ev2.map(e => e.event), ['page_view', 'buy_click', 'modal_close']);
  assert.strictEqual(ev2[1].device, 'desktop');
  await ctx2.close();

  /* ---------------- Live mode against the real Apps Script code ---------------- */
  log('\n=== LIVE MODE (requests intercepted, fed to backend/apps-script.gs in a mock Sheet) ===');
  const FAKE_URL = 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec';
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const posts = [];
  const env = createEnv({ ADMIN_KEY: 'correct horse battery staple' });
  await ctx3.route('**/config.js', async route => {
    const res = await route.fetch();
    const body = (await res.text()).replace('APPS_SCRIPT_URL: ""', `APPS_SCRIPT_URL: "${FAKE_URL}"`);
    await route.fulfill({ response: res, body });
  });
  await ctx3.route('https://script.google.com/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      posts.push({ url: req.url(), headers: req.headers(), body: req.postData() });
      env.postRaw(req.postData());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    const u = new URL(req.url());
    const out = env.get(Object.fromEntries(u.searchParams));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  const p3 = await ctx3.newPage();
  const c3 = [];
  p3.on('console', m => c3.push(m.text()));
  await runFlow(p3, c3);
  await p3.waitForTimeout(300);
  assert.strictEqual(await p3.isVisible('.preview-badge'), false, 'no preview badge in live mode');
  log('POSTs sent:', posts.length);
  posts.forEach(p => {
    assert.strictEqual(p.headers['content-type'], 'text/plain;charset=utf-8');
    assert.ok(!p.url.toLowerCase().includes('example.com'), 'no email in URL');
  });
  const evRows = env.table('events');
  log('events sheet rows:', evRows.map(r => r.event).join(', '));
  const buyersRows = env.table('buyers');
  log('buyers sheet (Apps Script):');
  console.table(buyersRows.map(b => ({ email: b.email, buy_clicks: b.buy_clicks, plan: b.plan, price_shown: b.price_shown, baby_stage: b.baby_stage, wanted_feature: b.wanted_feature, would_buy: b.would_buy, pay_preference: b.pay_preference, max_per_year: b.max_per_year, updates_opt_in: b.updates_opt_in, utm_source: b.utm_source, utm_campaign: b.utm_campaign, device: b.device })));
  assert.strictEqual(buyersRows.length, 1);
  assert.strictEqual(buyersRows[0].email, EMAIL);
  assert.strictEqual(buyersRows[0].buy_clicks, 2);
  assert.ok(Object.prototype.toString.call(buyersRows[0].first_click) === '[object Date]' && buyersRows[0].latest_click.getTime() > buyersRows[0].first_click.getTime(), 'first/latest click times'); log('first_click', buyersRows[0].first_click.toISOString(), 'latest_click', buyersRows[0].latest_click.toISOString());
  log('count endpoint:', JSON.stringify(env.get({ action: 'count' })));
  assert.deepStrictEqual(env.get({ action: 'count' }), { buyClicks: 2, uniqueBuyers: 1, buyersWithEmail: 1 });

  // Admin page in live mode: wrong key, then right key
  const a3 = await ctx3.newPage();
  await a3.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  assert.strictEqual(await a3.isVisible('#key-card'), true, 'asks for key');
  await a3.fill('#admin-key', 'wrong');
  await a3.click('#key-form button');
  await a3.waitForSelector('#key-error:not([hidden])');
  log('Wrong key message:', await a3.textContent('#key-error'));
  await a3.fill('#admin-key', 'correct horse battery staple');
  await a3.click('#key-form button');
  await a3.waitForSelector('#buyers-table tbody tr td');
  const tiles3 = await a3.evaluate(() => ['t-visitors', 't-clicks', 't-buyers', 't-emails', 't-noemail']
    .map(id => document.getElementById(id).textContent));
  log('Live admin tiles:', tiles3.join(' | '));
  assert.deepStrictEqual(tiles3, ['1', '2', '1', '1', '0']);
  assert.strictEqual(await a3.evaluate(() => localStorage.getItem('fd_admin_key')), 'correct horse battery staple');
  await ctx3.close();

  await browser.close();
  log('\nALL E2E CHECKS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
