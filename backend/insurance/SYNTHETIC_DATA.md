# Synthetic provider ranking demo

All provider names, products, prices, vehicle values, deductibles, add-ons and eligibility in `synthetic-quotes.json` are fictional software fixtures. They are not market quotes, provider quality ratings or coverage promises. Each row is for the same demo car, one year of comprehensive cover, INR, and the selected start date. No customer data is included.

| Fictional provider | Premium | IDV | Combined deductible | Add-ons |
| --- | ---: | ---: | ---: | --- |
| Sample Insurer A | 9,400 | 500,000 | 1,000 | Zero depreciation |
| Sample Insurer B | 8,500 | 470,000 | 2,000 | None |
| Demo Cedar Insurance | 12,900 | 550,000 | 500 | Zero depreciation, roadside, engine |
| Demo Maple Insurance | 10,900 | 520,000 | 2,000 | Zero depreciation, roadside |
| Demo Willow Insurance | 11,900 | 600,000 | 1,000 | Zero depreciation, roadside, return to invoice |

Open the app, choose **Try sample renewal**, then **See quotes**. In the quote screen choose:

- **Lowest premium**: B leads at ₹8,500.
- **Zero depreciation under ₹10,000**: A is the only matching provider.
- **Lower deductible under ₹14,000**: Cedar leads with a ₹500 combined deductible. This ranks the deductible only; actual repair costs also depend on terms and coverage.

These example buttons explicitly replace the comparison preferences. You can edit them afterward. No preference means a neutral comparison. Hard requirement failures are unranked and cannot be selected. Equally ranked matches share a rank; no unique best match is invented. Ranks describe a fit to the current preferences, not an overall insurer rating. Clicking **Sort by price** changes presentation without confirming a price preference.

NCB, verified garages, add-on limits and insurer terms remain unconfirmed. There is no real insurer integration. The original A/B scenarios in `insurance.md` still apply; three extra fictional providers are above the original ₹10,000 cap.
