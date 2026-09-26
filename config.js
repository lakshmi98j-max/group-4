/*
 * Site configuration. This is the only file you need to edit for day-to-day changes.
 * Everything here is public (it ships to every visitor's browser), so never put a
 * password or the admin key in this file.
 */
window.SITE_CONFIG = {
  // Brand name shown everywhere on the site. Change it here to rename the product.
  BRAND: "Wren",

  // Paste your Google Apps Script web app URL here (see README, step 5).
  // Leave it empty ("") to run in preview mode: events are kept in this browser only
  // and a small "Preview mode: data not saved" badge is shown.
  APPS_SCRIPT_URL: "",

  // Price test. Each visitor is randomly given one of these band prices and keeps it on
  // return visits. Every event records the price they saw.
  // Use a single value, for example [249], to switch the price test off.
  priceVariants: [199, 249, 299],

  // Price of one year of the Plus membership, added on top of the band price.
  // The "Band + Plus" plan costs: visitor's band price + plusAddOn.
  // With the variants above that is 278, 328 or 378.
  plusAddOn: 79,

  // Currency shown next to prices.
  currencySymbol: "$",
  currencyCode: "USD",

  // Contact address shown on the privacy page for data and deletion requests.
  CONTACT_EMAIL: "privacy@example.com"
};
