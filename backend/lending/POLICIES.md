# Demo lending rules

Policy ID: `paytm-journey-simulation-v1`, version `2026-11-14`.

All thresholds below are authored hackathon assumptions. They are NOT Paytm,
CIBIL, AA, HDFC, SBI or another real lender's underwriting rules. The earlier
HDFC/SBI engine has been replaced. No actual bureau, bank or Paytm access occurs.
Real lender decision reasons and a contracted policy version would be needed to
explain a production offer. Public marketing pages alone cannot establish causation.

## Lender presentation

Offer cards use Hero FinCorp, Tata Capital and Aditya Birla Capital as illustrative
lender names. The existing internal partner IDs stay stable for API compatibility.
These are not offers issued by those lenders, and no actual lender's underwriting
or interest-rate policy is represented. One page-level notice explains this;
individual answers use natural report-based language instead of repeating notices.

Partnership reference pages (checked 2026-11-14):
- https://www.herofincorp.com/paytm-guideline
- https://paytm.com/offer/personal-loan-faqs

## Credit and offer rules

- The three illustrative offers use minimum scores 720, 660 and 620; maximum amounts
  INR 500,000, 300,000 and 150,000; annual reducing-balance rates 14%, 19% and 24%.
- Demo entry conditions: resident Indian; age at least 23 and at most 60 at loan
  maturity; accepted monthly income at least INR 15,000; no reported overdues.
- A confirmed income discrepancy pauses all offers until corrected/reviewed.
- Available tenures: 12, 24 and 36 months. Minimum offer INR 10,000; amounts rounded
  down to INR 1,000 increments. Processing fee is explicitly zero in this demo.
- The partner amount cap is scaled by score: 100% for 750+, 65% for 680-749,
  35% below 680. This cap is NOT a credit-score model or approved amount formula.
- Chance labels are qualitative demo categories, not probabilities. Blocked offers
  are low. Available offers below score 680 are low. High requires score 750+,
  no more than two recent enquiries, utilization at most 30%, and stable salary
  credits (minimum/maximum monthly credits at least 80%); other available offers
  are medium. Labels describe the specific synthetic offer, not a real decision.

## Monthly budget and affordability

Accepted income is the minimum matching synthetic bank salary credit total across
the three demonstration months. A successful salary-slip check cannot increase it
above that bank figure. Missing salary months produce zero accepted income.

Existing monthly obligations = active-account EMIs + recorded minimum card
payments. The fixture currently sets card minimums to 5% of outstanding balances;
this is a data-generation assumption, not any issuer's actual minimum-payment rule.

New-EMI capacity = max(0, min(40% of income - obligations,
income - obligations - essential monthly expenses)). The customer's entered budget
can only lower this capacity, never raise it. Paytm receipts are not added to bank
income, avoiding double-counting. The amount offered is constrained by the request,
partner risk cap and EMI capacity. Display total interest and repayment alongside
EMI; a longer tenure may reduce EMI but increase total interest. Instalments are
rounded upward to paise and totals assume identical rounded instalments; a real
lender may adjust the final instalment and include fees in APR.

## Synthetic transaction-history rules: at most five supporting points

Evaluate only the three fixture months, August-October 2026:

| Signal | Points |
| --- | --- |
| Eligible inflows in all three months | 2 |
| Eligible inflows in exactly two months | 1 |
| All three months have inflows and minimum/maximum monthly inflow >=70% | 2 |
| Average eligible monthly inflow >=INR 3,000 | 1 |

Eligible inflows are explicitly labelled synthetic salary/merchant receipts.
Self-transfers and refunds are excluded. Spending amounts, outgoing frequency,
and sheer transaction count earn no points. The API still exposes totals sent and
received for context. Without transaction history there is no penalty or points.

Each point allows at most a 1% uplift to the demo risk amount cap, capped at the
partner maximum. Points never change the credit score, chance thresholds,
affordability capacity, overdue blocks or KYC/age/product requirements. This is
an optional supporting model assumption, not a claim that more Paytm usage earns
better offers. No advice should encourage extra spending or borrowing to get points.

## Income evidence and explanations

Salary-slip records must match the synthetic account-holder name, employer, month
and matching salary-credit totals (INR 1 tolerance). Three distinct months are
required. Missing/duplicate/out-of-period records and mismatches request review.
Multiple salary credits from the same named employer in one month are summed.
Matching records corroborate synthetic credits; they do not establish authenticity.
The current input is structured salary-slip fields, not a PDF/image upload or OCR.

The report includes account labels, due dates, paid dates, amount due, amount paid,
carried arrears, month-end DPD, and payment delay. A card can be paid late but fully
cleared before month end: payment delay is then positive while month-end DPD and
overdue are zero. Bank debit records match the fixture's actual paid amounts.
The bot receives the full report, salary credits, transaction histories and income
check results. It also receives the actual binding offer limit: monthly budget,
affordability, credit-profile cap, product maximum or rounding. Contextual credit
observations are not substituted for a confirmed blocking/amount-limit reason.
Both local and AI answers are short and question-specific; successfully repaid
closed loans count as positive history even in a currently stressed profile.
The bot exposes deterministic positive factors, limitations, evidence paths and
next steps. The selected offer has explicit simulated decision reasons. Sarvam is
an optional language layer and cannot set eligibility, change offers or execute
tools. AI failure returns a labelled deterministic fallback. Do not describe
enquiries or debts as moral failures; contextualize them. Guidance cannot promise
approval, a higher amount or a score increase.

All sample dates, employer/account names, balances, histories, income and decisions
are synthetic. PAN/phone only select a repeatable fixture; no financial fact is
inferred from their characters. Optional scenario selection makes demos reproducible.
