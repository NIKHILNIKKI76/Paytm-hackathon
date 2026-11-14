# Paytm car insurance renewal

Build a renewal flow for private cars that learns what matters to the customer as they go. Ask brief, optional questions where an answer would change the results. Finish with insurer quotes, an explanation of the best match when one exists, and a side-by-side comparison. The hackathon uses sample policies and quotes and ends at quote selection.

## Implementation

| Step | Build |
| --- | --- |
| **1. Confirm car and current cover** | Accept a registration number or manual vehicle details. Offer optional PDF or image upload to prefill the current insurer, cover, expiry, insured declared value (IDV), deductibles and add-ons. Let the customer correct extracted fields. Ask separately about claims since issuance. |
| **2. Build context during the flow** | Update context when the customer confirms a field, corrects an extraction, answers a question, sorts quotes or selects one. Ask inline where useful, such as **Keep zero depreciation?** alongside the current add-ons. Treat actions such as sorting by price as hints. Allow skipping and avoid repeating optional prompts during the same visit. |
| **3. Filter and rank quotes** | Check insurer eligibility and compare equivalent cover types and terms by default. Apply confirmed must-haves, then rank by confirmed priorities such as lower premium or lower repair contributions. Show a neutral comparison when preferences are sparse. Flag unknown terms for verification. If no quote meets all requirements, explain what each nearby option misses. |
| **4. Show the results** | List insurer and product, total premium, term, cover type, IDV, compulsory and voluntary deductibles, add-ons and applicable conditions. Explain the match and the trade-offs with alternatives. Offer **Compare with my policy**, **Edit preferences**, and **Select quote**. Re-rank when preferences change. Refresh quotes when coverage inputs change and insurer options support it. |
| **5. Improve on return** | Prefill preferences the customer explicitly saved. Reconfirm budget, claim history and coverage dates when relevant. Let customers update, clear or turn off saved preferences. Use aggregate skip and correction rates to improve prompts. |

## Data and decisions

- **Vehicle and renewal.** Capture registration, city, make/model/variant, registration year, desired start date, current policy and expiry, recent claim history, and prior No Claim Bonus (NCB). Confirm active third-party cover for standalone own-damage quotes.
- **Preferences.** Capture cover type, hard or flexible budget, upfront premium versus repair costs, required or preferred add-ons, and optional minimum IDV or preferred cashless garage. Store each preference with its source, confirmation state, scope and last update. The latest explicit correction takes precedence. Save across visits only when the customer chooses to.
- **Insurer quotes.** Keep insurer/product, quote reference and validity, start date and term, total payable, NCB applied, IDV, deductibles, add-ons and limits, and any inspection or issuance conditions. Include verified garage availability where relevant. Link to the applicable terms.
- **AI and rules.** Use AI to extract policy details, propose preferences from free text for confirmation, and explain trade-offs from quote fields and policy clauses. Use rules for eligibility, filters, ranking and price differences. Insurers supply prices and terms and handle issuance and claims. Use sample documents and keep customer documents out of Git and logs.

## Demo and checks

Use two sample one-year comprehensive quotes for the same car.

| | Quote A | Quote B |
| --- | ---: | ---: |
| Total premium | ₹9,400 | ₹8,500 |
| IDV | ₹5,00,000 | ₹4,70,000 |
| Compulsory deductible | ₹1,000 | ₹1,000 |
| Voluntary deductible | ₹0 | ₹1,000 |
| Zero depreciation | Included | Absent |

1. Upload the old policy and confirm the details. Ask about zero depreciation inline. With it required and a ₹10,000 cap, show **Quote A**.
2. Make the add-on optional and prioritise upfront price. Show **Quote B** and explain the ₹900 saving, lower IDV, and extra voluntary deductible.
3. Restore the required add-on and set a ₹9,000 cap. Show why neither quote qualifies.
4. Simulate a return visit with a saved add-on preference. Prefill it, allow an edit for this visit, and offer to save the change.

Test manual entry, unreadable uploads, missing quote fields, skipped prompts, and sorting without confirming a preference. Measure time to quotes, fields typed or corrected, and whether customers understand the trade-offs.

Verify live quote fields, re-quote options and insurer handoff before integration. [Paytm car insurance](https://paytminsurance.co.in/car-insurance/) · [Paytm purchase process](https://paytm.com/insurance-isnp-processes) · [Broker disclosures](https://paytminsurance.co.in/our-policies/disclosures/)
