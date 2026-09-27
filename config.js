/*
 * Site configuration. This is the only file you need to edit for day-to-day changes.
 * Everything here is public (it ships to every visitor's browser), so never put a
 * password or the admin key in this file.
 */
window.SITE_CONFIG = {
  // Brand name shown everywhere on the site. Change it here to rename the product.
  BRAND: "Dawn",

  // Paste your Google Apps Script web app URL here (see README, step 5).
  // Leave it empty ("") to run in preview mode: events are kept in this browser only
  // and a small "Preview mode: data not saved" badge is shown.
  APPS_SCRIPT_URL: "",

  // Price test for the yearly membership (the "base model" on the test card).
  // Each visitor is randomly given one of these yearly prices and keeps it on return
  // visits. Every event records the price they saw.
  // Use a single value, for example [199], to switch the price test off.
  priceVariants: [149, 199, 249],

  // One-time price for the band with no membership. It stays the same for everyone, so
  // the dashboard can compare "subscription vs one-time" at each membership price.
  oneTimePrice: 299,

  // Currency shown next to prices.
  currencySymbol: "$",
  currencyCode: "USD",

  // Contact address shown on the privacy page for data and deletion requests.
  CONTACT_EMAIL: "privacy@example.com",

  // The Strategyzer test card this site is measuring. Shown on the admin dashboard.
  TEST_CARD: {
    name: "Business model + WTP",
    assignedTo: "Dawn (Team 4)",
    hypothesis: "Parents will pay $200/year for the base model.",
    // "We are right if parents agree to pay at least $200/year."
    // A reservation counts as agreeing if they reserved the membership at a yearly
    // price of at least wtpThreshold (and did not answer "Maybe at a lower price" or
    // "No, just curious"), or answered that they would pay $200+ a year.
    // 199 means "$199/year counts as the $200/year mark".
    wtpThreshold: 199,
    targetCustomers: 50,
    startDate: "2026-09-25",
    deadline: "2026-10-05"
  }
};
