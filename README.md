# Dawn: fake door demand test

A product landing page for **Dawn**, a soft baby chest band with an 18-gram sensor pod ("Peace of mind, measured in real time"). The page looks like a real product page with Buy buttons, but **nothing is sold**. It measures demand:

1. Every click on a Buy button is recorded right away (so the click count is accurate even if people leave).
2. A "Reserve your Dawn" window opens and asks for an email to reserve a spot, plus five optional questions.
3. People are told honestly that Dawn is not on sale yet and that they have not been charged.

It is built to run the team's Strategyzer **test card "Business model + WTP"**:

| | |
| --- | --- |
| We believe that | Parents will pay $200/year for the base model |
| To verify that, we will | Launch the MVP page with at least 50 customers |
| And measure | Willingness to pay, and preference: subscription vs one-time |
| We are right if | Parents agree to pay at least $200/year |
| Deadline | October 5, 2026 (10 days) |

How the page measures it:

- **Two plans side by side**: *Dawn Membership* (a yearly price, band included) and *Dawn Band* (a one-time price, no membership). Which one people click in the pricing section is the subscription vs one-time preference.
- **Price test on the membership**: each visitor sees $149, $199 or $249 a year, so the dashboard shows how demand changes around the $200 mark.
- **Two direct questions in the reserve form**: "How would you rather pay?" and "The most you'd pay per year for Dawn".
- **A Test card panel on the dashboard** that counts parents who agreed to pay $200+ a year against the target of 50, with days left to the deadline.

Data is stored permanently in a Google Sheet that you own, and you can read the results on a private dashboard (`admin.html`).

- Live site: `https://lakshmi98j-max.github.io/group-4/`
- Admin dashboard: `https://lakshmi98j-max.github.io/group-4/admin.html` (not linked from the site, hidden from search engines)

No payment or card details are ever collected, and there is no fake checkout.

---

## What is in this repo

| File | What it is |
| --- | --- |
| `index.html` | The landing page |
| `privacy.html` | Plain-language privacy notice |
| `admin.html` | Your results dashboard |
| `config.js` | **The file you edit**: brand name, prices, Apps Script URL, contact email |
| `css/`, `js/`, `fonts/` | Styles, scripts and the self-hosted heading font |
| `backend/apps-script.gs` | The Google Apps Script that saves data into your Google Sheet |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages on every push to `main` |
| `tests/` | Optional automated tests (for developers) |

Plain HTML, CSS and JavaScript. No framework and no build step.

---

## One-time setup

### Step 0. Turn on GitHub Pages (once)

1. Open the repo on GitHub: `https://github.com/lakshmi98j-max/group-4`
2. Click **Settings** (top bar of the repo), then **Pages** (left sidebar).
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. If the latest "Deploy site to GitHub Pages" run failed because Pages was not on yet, open it and click **Re-run all jobs**.

After a minute the site is live at `https://lakshmi98j-max.github.io/group-4/`.

Until you finish the steps below, the site runs in **preview mode**: everything works, but events are only kept in your own browser and a small "Preview mode: data not saved" badge shows in the corner.

### Step 1. Create a new Google Sheet

Go to [sheets.new](https://sheets.new) while signed in to your Google account. Name it something like "Dawn demand test". You do not need to add any columns; the script creates the `events` and `buyers` tabs and their headers automatically.

### Step 2. Add the script

1. In the Sheet, click **Extensions > Apps Script**.
2. Delete everything in the editor (`Code.gs`).
3. Open `backend/apps-script.gs` from this repo, copy **all** of it, and paste it into the editor.
4. Click the **Save** icon (or press Ctrl+S / Cmd+S).

Optional but recommended: in the toolbar, pick the function **setup** and click **Run**. Google will ask for permission (see "The Google permission screen" below). This creates both tabs right away.

### Step 3. Set your admin password

1. In the Apps Script editor, click the **gear icon (Project Settings)** in the left sidebar.
2. Scroll to **Script Properties** and click **Add script property**.
3. Property: `ADMIN_KEY`. Value: a strong password (for example 4 random words, at least 16 characters).
4. Click **Save script properties**.

This key is what unlocks `admin.html`. It lives only in Google. **Never put it in this repo or in `config.js`.**

### Step 4. Deploy the web app

1. In the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Description: anything, for example "v1".
4. **Execute as: Me**.
5. **Who has access: Anyone** (not "Anyone with a Google account"; visitors are not signed in).
6. Click **Deploy**, approve the permission screen, then **copy the Web app URL**. It looks like `https://script.google.com/macros/s/AKfy.../exec`.

**The Google permission screen.** Because this is your own new script, Google shows "Google hasn't verified this app". Click **Advanced**, then **Go to (your project name) (unsafe)**, then **Allow**. The script only gets access to the spreadsheet it is attached to.

### Step 5. Paste the URL into `config.js`

1. On GitHub, open `config.js` and click the pencil icon to edit.
2. Paste the URL between the quotes:
   ```js
   APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfy.../exec",
   ```
3. Click **Commit changes** (commit directly to `main`).

The site redeploys automatically in about a minute (watch the **Actions** tab). The Apps Script URL is fine to have in the repo: it only accepts events and the public totals. Reading the detailed data needs the admin key.

### Step 6. Test it end to end

1. Open the live site. The "Preview mode" badge should be gone.
2. Click any **Buy** button. A "Reserve your Dawn" window opens.
3. Enter a test email, answer the questions if you like, and click **Reserve my spot**.
4. Click **Buy** again. It should say "You're already on the list as (your email)".
5. Open your Google Sheet. The `events` tab has one row per event. The `buyers` tab has **one row for your email with 2 buy clicks**.
6. Open `https://lakshmi98j-max.github.io/group-4/admin.html`, enter your `ADMIN_KEY`, and check the numbers.

To start fresh after testing, delete the test rows in both tabs (keep row 1, the headers), and in your browser clear the site data for the page (or use a private window).

---

## Running ads: UTM links

Add tags to the link in each ad so the dashboard can tell traffic sources apart:

```
https://lakshmi98j-max.github.io/group-4/?utm_source=instagram&utm_medium=paid&utm_campaign=launch1
https://lakshmi98j-max.github.io/group-4/?utm_source=facebook&utm_medium=paid&utm_campaign=launch1
https://lakshmi98j-max.github.io/group-4/?utm_source=tiktok&utm_medium=paid&utm_campaign=creative_b
```

- `utm_source`: where the ad runs (instagram, facebook, tiktok, google, newsletter...)
- `utm_medium`: the kind of traffic (paid, organic, email...)
- `utm_campaign`: your name for this campaign or creative

Use lowercase and no spaces. The tags are captured when someone lands and kept for their whole visit. The "Buy clicks by traffic source" chart groups by `utm_source`.

---

## Everyday changes (all in `config.js`)

Edit `config.js` on GitHub (pencil icon), commit to `main`, and the site updates in about a minute.

**Change the brand name**

```js
BRAND: "Dawn",
```

Change `"Dawn"` to the new name. Every visible mention on the page, the page titles, plan names and the modal update automatically. The HTML files still contain "Dawn" as the default text, so search engine and link previews keep saying "Dawn" until you also find-and-replace it in `index.html`, `privacy.html` and `admin.html`.

**Change prices / the price test**

```js
priceVariants: [149, 199, 249],
oneTimePrice: 299,
```

- `priceVariants` are the yearly **membership** prices being tested. Each new visitor is randomly given one and keeps it on return visits. Every event records the price they saw, so the dashboard can compare prices.
- One value, for example `[199]`, switches the price test off.
- `oneTimePrice` is the one-time price of the band with no membership. It is the same for everyone, so "membership vs one-time" can be compared at each membership price.
- If you change the list, visitors whose old price is no longer in the list get a new one on their next visit.

**Change the test card**

`TEST_CARD` in `config.js` holds the test name, hypothesis, target (`targetCustomers: 50`), deadline and `wtpThreshold`. A reservation counts as "agreed to pay $200+ a year" if the person reserved the membership at `wtpThreshold` or more per year without answering "Maybe at a lower price" or "No, just curious", or if they said the most they would pay per year is $200 or more. `wtpThreshold: 199` treats $199/year as the $200 mark.

**Other settings:** `currencySymbol` and `currencyCode` for how prices display, and `CONTACT_EMAIL` for the privacy page. **Fill in `CONTACT_EMAIL` before running ads**; it is where people ask for their data to be deleted.

---

## Changing the Apps Script later

If you edit the script in the Apps Script editor (or paste a newer `backend/apps-script.gs`), the live web app keeps running the **old** version until you publish a new version:

1. Click **Deploy > Manage deployments**.
2. Select your web app deployment and click the **pencil (Edit)** icon.
3. Under **Version**, choose **New version**.
4. Click **Deploy**.

The URL stays the same, so there is nothing to change in `config.js`. (Using "New deployment" instead would create a new URL.)

---

## Reading the results

**Test card panel (top of the dashboard, all dates):**

- **Parents who agreed to pay $200+ a year**, out of the target of 50, with how many came from reserving at $199+/year and how many from the "most per year" answer.
- **Customers reserved**, out of the target of 50.
- **Preference: subscription vs one-time**, both from what people clicked in the pricing section and from what they said in the form.
- Days left to the deadline, and whether the criteria is met yet.

**Headline: buy-click rate** = unique visitors who clicked any Buy button ÷ unique visitors. This is the main demand signal.

Also on the dashboard:

- **Tiles**: unique visitors, total buy clicks, unique buyers, buyers with email, and "clicked Buy but left no email".
- **Buy clicks per day**, with a table view.
- **Funnel**: visited, scrolled to pricing, clicked Buy, reserved with email.
- **Buy-click rate by membership price**: each price shows its sample size and a 95% Wilson range. The range is where the true rate probably is. If two prices' ranges overlap a lot, the difference may just be chance. Aim for at least 100 visitors per price before drawing conclusions.
- **Membership or one-time, at each membership price**: from Buy clicks in the pricing section, where both plans are shown side by side.
- **By plan, button (nav / hero / pricing), traffic source and device.** The nav and hero Buy buttons open the membership, the headline offer.
- **Survey answers**: baby stage, most wanted feature, "would you buy at this price?", "how would you rather pay?" and "the most you'd pay per year".
- **Who clicked Buy**: one row per email, searchable and sortable, with a **Download CSV** button.
- **Date filter** (today / 7 days / 30 days / all) and **Refresh**.

The admin key is saved only in the browser you type it into. Use **Forget key** on shared computers.

There is also a public totals link you can open any time:
`YOUR_APPS_SCRIPT_URL?action=count` returns `{"buyClicks": ..., "uniqueBuyers": ..., "buyersWithEmail": ...}`.

### What gets recorded

Events: `page_view`, `scroll_to_pricing` (once per visit), `buy_click`, `reserve`, `modal_close`.

Every event row in the `events` tab has: server time, event name, browser time, event id, visitor id, session id, email (if known), plan (`membership` or `onetime`), price shown, the visitor's membership price variant, button location, utm_source, utm_medium, utm_campaign, referrer (site only, no query string), device type (mobile / tablet / desktop), page path, and the survey answers on `reserve` events.

The `buyers` tab has one row per email: email, first buy click time, latest click time, number of buy clicks, plan, price shown, baby stage, most wanted feature, would-buy answer, pay preference, most per year, updates opt-in, utm_source, utm_campaign, device, when they reserved, and the visitor ids linked to that email. The click count includes the anonymous clicks the same visitor made before leaving their email, and is rebuilt from the `events` tab each time, so it stays exact.

Safety details in the script: a lock so simultaneous clicks do not collide, automatic sheet and header creation, long values cut to a safe length, and values starting with `=`, `+`, `-` or `@` stored as plain text so they can never run as spreadsheet formulas. Emails are never written to the browser console or put in a URL.

---

## Preview mode

If `APPS_SCRIPT_URL` in `config.js` is empty, the site never breaks: events are kept in the visitor's own browser (localStorage) and a small "Preview mode: data not saved" badge shows. `admin.html` then reads that browser's preview data without asking for a key, so you can try the dashboard before the Sheet exists. Use **Clear preview data** on the dashboard to reset.

---

## Troubleshooting

- **The admin page says the key was not accepted.** Check `ADMIN_KEY` in Script Properties matches exactly (no spaces). After 20 wrong tries it locks for 10 minutes.
- **The admin page says it could not load data.** Check the URL in `config.js` ends in `/exec`, and that the deployment has **Who has access: Anyone**.
- **Nothing appears in the Sheet.** Make sure you deployed after pasting the script, and that you used Deploy > Manage deployments > New version after any edit.
- **The site did not update.** Open the **Actions** tab on GitHub and check the latest run. Browsers can also cache for a few minutes; try a private window.
- **The price shown to me never changes.** That is expected: each visitor keeps their price. Use a private window to be assigned again.

---

## Honesty and safety notes

- The footer on every page says: "Concept product in development. Not a medical device. Not intended to diagnose, treat, cure, or prevent any disease."
- The page never claims Dawn prevents SIDS or diagnoses anything, and does not name any competitor.
- The reserve window says "No payment now, no card needed", and the confirmation says Dawn isn't on sale yet and they haven't been charged.
- The three quotes in the "Awake, again" section are real answers from the team's customer discovery interviews, shown word for word but without names, since these are private people.
- Mira (the AI guide) is always described as general guidance, not medical advice, that tells parents when to call their pediatrician.
- Market and competitor figures from the business case are kept off the consumer page.
- The retention periods in `privacy.html` (email kept until launch plus up to 12 months; visit data up to 24 months) are sensible defaults. Adjust them if you plan something different.

---

## For developers: tests

```bash
# Backend logic against an in-memory mock of Google Sheets (plain Node, no installs)
node tests/backend.test.js

# Full browser flow in preview mode and against the real Apps Script code (needs Playwright)
npx http-server -p 8080 &
node tests/e2e.js
```
