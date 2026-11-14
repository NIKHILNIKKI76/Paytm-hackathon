# Lending backend demo

TypeScript lending API with a local frontend in `frontend/lending`. PAN/phone -> synthetic CIBIL-style report, synthetic Paytm
transactions and AA bank transactions -> demo offers -> explanations and monthly
budget recommendations. No real bureau access, AA integration, Paytm
transaction access, actual bank decisions or disbursal is implemented.

API reports and offers retain synthetic metadata. The page has a single illustrative
offers notice; cards use Hero FinCorp, Tata Capital and Aditya Birla Capital as
example lender names, not actual offers from those institutions.
Read [POLICIES.md](./POLICIES.md) for every threshold, formula and limitation.

## Versions and start

Matches the root VERSIONS.md: Node **24.22.3**, npm **11.21.2**, TypeScript **7.0.2**.
The existing Sarvam SDK remains pinned to **1.1.19**. Development-only Node type
definitions are pinned to **24.10.0** (an additional selected tool, not a runtime).
No frontend libraries or HTTP-framework dependencies are needed; HTTP, validation,
test runner and TypeScript execution use Node's built-in facilities.

From `backend/lending`, with the baseline Node/npm active:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run typecheck:frontend
npm.cmd test
npm.cmd start
```

The repository-root `.env` supplies `SARVAM_API_KEY`; never commit or share it.
`npm start` launches the shared server and builds the lending browser script.
Open `http://127.0.0.1:3001/lending/` for Lending or `/` for Insurance.
Set `PORT` in the root `.env` to change the shared port.
AI is invoked only when chat input explicitly includes `useAi: true`.
Missing keys return 503 without making a request. Default chat works from local
decision facts without any external request.

A project-local exact runtime was installed in ignored `.runtime` during setup
because the machine's global versions differ. To use it in this PowerShell session:

```powershell
$env:Path = (Resolve-Path .runtime/node_modules/node/bin).Path + ';' + $env:Path
node --version
node .runtime/node_modules/npm/bin/npm-cli.js --version
node .runtime/node_modules/npm/bin/npm-cli.js run typecheck
node .runtime/node_modules/npm/bin/npm-cli.js test
node .runtime/node_modules/npm/bin/npm-cli.js start
```

`.runtime` is local tooling and isn't needed when the baseline is already active.

## API

All POST bodies use `Content-Type: application/json` (32 KiB maximum). Amounts are
INR numbers, not strings; phone is a ten-digit string. Positive amounts accept up
to two decimal places. PAN and phone are format-checked, NOT identity-verified.
Use synthetic identifiers in the demo. No raw PAN/phone is stored or logged;
responses contain masked versions. Identifiers only select one of three fixtures.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Local service status |
| POST | `/applications` | Create demo profile and return report, transactions and offers |
| GET | `/applications/:id` | Full current application snapshot |
| GET | `/applications/:id/credit-report` | Summary and expandable account/payment/enquiry detail |
| GET | `/applications/:id/transactions` | Synthetic Paytm and AA histories plus transaction factor |
| GET | `/applications/:id/offers` | Current offers, chance labels, budget limits and reasons |
| POST | `/applications/:id/budget` | Recalculate using monthly budget and optionally requested amount |
| POST | `/applications/:id/income-check` | Compare structured salary-slip records with synthetic AA credits |
| POST | `/applications/:id/chat` | Explain an assessment or selected offer, optionally through Sarvam |

### Create application

```json
{
  "pan": "ABCDE1234F",
  "phone": "9876543210",
  "demoConsent": true,
  "requestedAmount": 200000,
  "monthlyBudget": 3000,
  "scenario": "moderate"
}
```

`demoConsent` acknowledges that this is a simulation; it is NOT bureau or AA consent.
Only PAN, phone and demoConsent are required. Requested amount defaults to INR
200,000; absent monthly budget uses the demo policy capacity. `scenario` is optional:
`strong` (screenshot-style 781, no loan balance/overdues/enquiries), `moderate`
(smaller/medium-chance offers) or `stressed` (overdues, high obligations, no offer).
Omit scenario to select a repeatable fixture from the identifiers. Profiles use
reference date **2026-11-14**, not live data. All names and incomes are fictional.

The response includes an opaque `id`. Use it for subsequent requests. Offers show
`available`, `chance`, `amount`, `annualInterestRate`, `tenureMonths`, `monthlyEmi`,
`totalRepayment`, `totalInterest`, `processingFee` and explicit decision reasons.
Unavailable offers remain visible with amount/EMI zero and blocking reasons;
never treat their advertised rate/tenure as an available loan. These are personal
loan demo offers, not home-loan or merchant-loan underwriting.

### Monthly repayment budget

```json
{ "monthlyBudget": 2000, "requestedAmount": 150000 }
```

The budget is the amount available for the NEW loan EMI, in addition to existing
obligations. Offers never exceed the smaller of this budget and demo policy
capacity. Send `monthlyBudget: null` to remove the customer cap. Zero/negative
budgets are rejected; a positive budget too small for any offer returns no offer.
Compare total interest as well as EMI. No claim of approval is made.

### Salary-slip cross-check

```json
{
  "salarySlips": [
    { "employeeName": "Arjun Mehta", "employer": "Northstar Technologies Pvt Ltd", "month": "2026-08", "netSalary": 40000 },
    { "employeeName": "Arjun Mehta", "employer": "Northstar Technologies Pvt Ltd", "month": "2026-09", "netSalary": 40000 },
    { "employeeName": "Arjun Mehta", "employer": "Northstar Technologies Pvt Ltd", "month": "2026-10", "netSalary": 40000 }
  ]
}
```

This matches the moderate fixture. Strong uses INR 60,000 each month; stressed has
INR 25,000 / 18,000 / 25,000 bank salary credits. The endpoint consumes structured
fields; it does NOT parse uploaded PDF/image files. Mismatches pause offers and
return month-specific issues. A corrected request rechecks all records and can
clear the review state. `authenticityVerified` is always false.

### Explanation bot

```json
{
  "question": "Why is my offer smaller, and what can I do next?",
  "offerId": "demo-partner-b-24",
  "useAi": true
}
```

Omit offerId for the full profile. Omit useAi or set false for a deterministic
explanation. The response always includes structured strengths, limitations,
evidence, next steps and up to three affordable recommendations. Recommendations
sort by amount, then lower total interest for equal amounts. None override budget.
Sarvam receives decision facts and the question, not PAN, phone or raw salary
records; PAN/phone patterns in questions are redacted. Avoid putting other private
information in a question. Structured decision facts are authoritative; generated
wording is labelled as AI. Upstream failure yields `source: local_fallback`.

## Limits

Sessions are in memory, expire after one hour, and disappear on restart (maximum
100 sessions). IDs act as local demo access tokens; do not share them. The server
binds only to loopback. Production authentication, persistent storage, real KYC,
bureau/AA consent and integrations, OCR/file uploads and real lender policies are
outside this implementation. The frontend and API share one origin, so no CORS
configuration is needed. Both applications run together through the shared root server.
