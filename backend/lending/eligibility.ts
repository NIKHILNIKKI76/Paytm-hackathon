import { DEMO_MONTHS } from "./demo-data.ts";
import { DEMO_NOTICE } from "./types.ts";
import type { Assessment, Factor, IncomeCheck, LoanOffer, Profile, Transaction } from "./types.ts";
import { amount } from "./validation.ts";

// Authored demo policy, NOT Paytm's or any named lender's underwriting policy.
export const DEMO_POLICY = {
  id: "paytm-journey-simulation-v1", version: "2026-11-14",
  minAge: 23, maxAgeAtMaturity: 60, minimumIncome: 15000,
  maximumObligationRatio: 0.4, cardObligationRate: 0.05,
  minimumOffer: 10000, minimumScore: 620, maximumTransactionPoints: 5,
  lenders: [
    { id: "demo-partner-a", name: "Demo Partner A", minimumScore: 720, maxAmount: 500000, annualRate: 14 },
    { id: "demo-partner-b", name: "Demo Partner B", minimumScore: 660, maxAmount: 300000, annualRate: 19 },
    { id: "demo-partner-c", name: "Demo Partner C", minimumScore: 620, maxAmount: 150000, annualRate: 24 },
  ], tenures: [12, 24, 36],
} as const;
const money = (value: number) => Math.round(value * 100) / 100;
const floorMoney = (value: number) => Math.floor(value * 100) / 100;
export function calculateEmi(principal: number, annualRate: number, months: number): number {
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isFinite(annualRate) || annualRate < 0
      || !Number.isInteger(months) || months <= 0) throw new Error("Invalid EMI inputs.");
  const rate = annualRate / 1200;
  return Math.ceil((rate === 0 ? principal / months : principal * rate / (1 - (1 + rate) ** -months)) * 100) / 100;
}
export function transactionFactor(transactions: Transaction[]) {
  const monthly = DEMO_MONTHS.map(month => transactions.filter(t => t.date.startsWith(month)
    && t.direction === "credit" && (t.category === "salary" || t.category === "merchant_receipt"))
    .reduce((sum, t) => sum + t.amount, 0));
  const activeMonths = monthly.filter(value => value > 0).length;
  const consistent = activeMonths === 3 && Math.min(...monthly) / Math.max(...monthly) >= 0.7;
  // 0–5 points: regularity 0/1/2, consistency 0/2, meaningful inflows 0/1.
  const average = monthly.reduce((a, b) => a + b, 0) / DEMO_MONTHS.length;
  const points = (activeMonths === 3 ? 2 : activeMonths === 2 ? 1 : 0)
    + (consistent ? 2 : 0) + (average >= 3000 ? 1 : 0);
  return { points, maximumPoints: 5 as const, eligibleMonthlyInflow: money(average), activeMonths,
    sentAmount: money(transactions.filter(t => t.direction === "debit").reduce((sum, t) => sum + t.amount, 0)),
    receivedAmount: money(transactions.filter(t => t.direction === "credit").reduce((sum, t) => sum + t.amount, 0)),
    explanation: "Demo-only supporting factor. Counts recurring salary/merchant inflows; excludes self-transfers and refunds. Amount sent and spending frequency earn no points. Paytm inflows are not added again to bank income." };
}
export function assessEligibility(profile: Profile, requestedAmount: number, monthlyBudget: number | null = null,
  incomeCheck?: IncomeCheck): Assessment {
  amount(requestedAmount, "requestedAmount");
  if (monthlyBudget !== null) amount(monthlyBudget, "monthlyBudget", 1000000);
  const credit = profile.report;
  const transactions = transactionFactor(profile.paytmTransactions);
  const salaryByMonth = DEMO_MONTHS.map(month => profile.aaTransactions.filter(t => t.direction === "credit"
    && t.category === "salary" && t.counterparty === profile.employer && t.date.startsWith(month))
    .reduce((sum, t) => sum + t.amount, 0));
  const bankIncome = Math.min(...salaryByMonth);
  const income = incomeCheck?.status === "matched_synthetic_credits"
    ? Math.min(bankIncome, incomeCheck.acceptedMonthlyIncome ?? 0) : bankIncome;
  const existingEmi = credit.accounts.filter(a => a.status === "active").reduce((sum, a) => sum + a.monthlyEmi, 0);
  const cardReserve = credit.summary.creditCard.outstanding * DEMO_POLICY.cardObligationRate;
  const obligations = money(existingEmi + cardReserve);
  const policyLimit = floorMoney(Math.max(0, Math.min(income * DEMO_POLICY.maximumObligationRatio - obligations,
    income - obligations - profile.essentialMonthlyExpenses)));
  const limit = Math.min(policyLimit, monthlyBudget ?? Infinity);
  const factors: Factor[] = [];
  const add = (code: string, kind: Factor["kind"], explanation: string, evidence: string[], nextStep: string | null = null) =>
    factors.push({ code, kind, explanation, evidence, nextStep });
  add("CREDIT_SCORE", credit.score >= 720 ? "positive" : "limitation", `Synthetic credit score: ${credit.score}.`,
    ["report.score"], credit.score < 720 ? "Review the report for errors and maintain timely repayments; no score improvement is guaranteed." : null);
  const late = credit.accounts.flatMap(a => a.payments.filter(p => p.daysPastDue > 0).map(p => `${a.id}:${p.month}`));
  add(late.length ? "LATE_PAYMENTS" : "ON_TIME_PAYMENTS", late.length ? "limitation" : "positive",
    late.length ? "The supplied synthetic payment history contains late-payment entries." : "No late payments appear in the supplied synthetic payment-history entries.",
    late.length ? late : credit.accounts.map(a => a.id), late.length ? "Check the listed months and accounts; dispute errors with the lender/bureau." : null);
  const overdue = credit.summary.totalOverdues.amount;
  add(overdue ? "OVERDUES" : "NO_OVERDUES", overdue ? "limitation" : "positive",
    overdue ? `Synthetic reported overdues total INR ${overdue}.` : "No overdues are shown.", ["report.summary.totalOverdues"],
    overdue ? "Confirm the balance with the lender and discuss resolving genuine overdue amounts." : null);
  const usage = credit.summary.creditCard.utilizationPercent;
  add("CARD_UTILIZATION", usage <= 30 ? "positive" : "limitation", `Synthetic card utilization is ${usage}%.`,
    ["report.summary.creditCard"], usage > 30 ? "Consider reducing revolving balances where affordable; do not borrow just to change utilization." : null);
  const enquiries = credit.enquiries.length;
  add("ENQUIRIES", enquiries <= 2 ? "positive" : "limitation", `${enquiries} hard enquiries appear in the synthetic recent-enquiry window.`,
    credit.enquiries.map(e => e.id), enquiries > 2 ? "Review unfamiliar enquiries and avoid unnecessary repeated applications. An enquiry is not automatically a mistake." : null);
  add("ACCOUNT_AGE", "information", `Oldest synthetic account is ${credit.summary.ageOfAccounts.oldestMonths} months old; the report rates this ${credit.summary.ageOfAccounts.rating}.`,
    ["report.summary.ageOfAccounts"], "Maintain accurate existing records; do not open loans solely to build account age.");
  add("AFFORDABILITY", policyLimit > 0 ? "information" : "limitation",
    `Demo monthly income INR ${income}; existing obligations INR ${obligations} (including a 5% card-balance reserve). New-EMI limit INR ${limit}.`,
    ["aaTransactions", "report.accounts", "demo_policy.maximumObligationRatio"],
    "Choose an EMI within your budget. Reducing obligations may help affordability but does not guarantee a larger offer.");
  add("TRANSACTION_CONTEXT", transactions.points > 0 ? "positive" : "information",
    `Synthetic transaction factor: ${transactions.points}/5 supporting points. ${transactions.explanation}`, ["paytmTransactions"],
    "Relevant, consented transaction history may help a lender assess cash flow. More Paytm use or spending alone does not guarantee eligibility.");
  const stableIncome = Math.max(...salaryByMonth) > 0 && bankIncome / Math.max(...salaryByMonth) >= 0.8;
  if (!stableIncome) add("INCOME_VARIATION", "limitation", "Synthetic monthly salary credits vary by more than the demo 20% tolerance.",
    ["aaTransactions"], "Provide recent salary-slip records and clarify any salary adjustments.");
  const incomeReview = incomeCheck?.status === "needs_review";
  if (incomeReview) add("INCOME_MISMATCH", "limitation", "Salary-slip cross-check needs review; demo offers are paused.",
    incomeCheck.issues.map(i => i.code), "Supply the missing or corrected records or clarify the mismatched salary credits.");

  const offers: LoanOffer[] = [];
  for (const lender of DEMO_POLICY.lenders) for (const tenure of DEMO_POLICY.tenures) {
    const blockers: Factor[] = [];
    const block = (code: string, explanation: string, evidence: string[]) => blockers.push({ code, kind: "limitation", explanation,
      evidence, nextStep: "Review this simulated decision reason. Actual criteria require the partner lender's policy." });
    if (credit.score < lender.minimumScore) block("BELOW_DEMO_SCORE", `Score is below ${lender.name}'s demo minimum ${lender.minimumScore}.`, ["report.score"]);
    if (overdue > 0) block("DEMO_OVERDUE_BLOCK", "Outstanding overdues block offers in this demo policy.", ["report.summary.totalOverdues"]);
    if (!profile.residentIndian || profile.age < DEMO_POLICY.minAge || profile.age + tenure / 12 > DEMO_POLICY.maxAgeAtMaturity)
      block("DEMO_PRODUCT_REQUIREMENTS", "Demo residency or age-at-maturity condition is not met.", ["profile.age", "profile.residentIndian"]);
    if (income < DEMO_POLICY.minimumIncome) block("DEMO_MINIMUM_INCOME", "Income is below the demo INR 15,000 minimum.", ["aaTransactions"]);
    if (incomeReview) block("INCOME_REVIEW_REQUIRED", "Resolve income discrepancies before considering a demo offer.", ["incomeCheck"]);
    // At most 5% uplift to a demo risk cap. Never changes score, affordability,
    // overdue blocks, or identity/product requirements.
    const riskCap = lender.maxAmount * (credit.score >= 750 ? 1 : credit.score >= 680 ? 0.65 : 0.35);
    const cappedAmount = Math.min(lender.maxAmount, riskCap * (1 + transactions.points / 100));
    const rate = lender.annualRate / 1200;
    const affordablePrincipal = limit * (1 - (1 + rate) ** -tenure) / rate;
    const principal = Math.floor(Math.min(requestedAmount, cappedAmount, affordablePrincipal) / 1000) * 1000;
    if (principal < DEMO_POLICY.minimumOffer) block("NO_AFFORDABLE_DEMO_AMOUNT", "No amount of at least INR 10,000 fits this demo offer and monthly limit.", ["affordability"]);
    const available = blockers.length === 0;
    const emi = available ? calculateEmi(principal, lender.annualRate, tenure) : 0;
    const reasons = [...blockers];
    if (available && principal < requestedAmount) reasons.push({ code: "LOWER_AMOUNT", kind: "limitation",
      explanation: `Requested INR ${requestedAmount}; this offer is limited to INR ${principal} by the demo risk/product cap INR ${floorMoney(cappedAmount)}, monthly limit INR ${limit} and INR 1,000 amount increments.`,
      evidence: ["demo_policy", "affordability", "report.score", "paytmTransactions"],
      nextStep: "Compare smaller amounts or other tenures. Longer tenures can increase total interest; approval is never guaranteed." });
    const chance = !available || credit.score < 680 ? "low"
      : credit.score >= 750 && enquiries <= 2 && usage <= 30 && stableIncome ? "high" : "medium";
    reasons.push(...factors.filter(f => ["CREDIT_SCORE", "AFFORDABILITY", "ENQUIRIES", "CARD_UTILIZATION", "TRANSACTION_CONTEXT", "INCOME_VARIATION"].includes(f.code)));
    offers.push({ id: `${lender.id}-${tenure}`, lender: lender.name, synthetic: true, policyId: DEMO_POLICY.id,
      available, chance, chanceMeaning: "Demo category, not a probability or promise of approval",
      amount: available ? principal : 0, annualInterestRate: lender.annualRate, tenureMonths: tenure,
      monthlyEmi: emi, totalRepayment: money(emi * tenure), totalInterest: available ? money(emi * tenure - principal) : 0,
      processingFee: 0, reasons });
  }
  const requestedDocuments = incomeReview ? incomeCheck.requestedDocuments : !stableIncome
    ? ["Recent salary-slip records for 2026-08, 2026-09 and 2026-10 to clarify varying salary credits."] : [];
  return { synthetic: true, notice: DEMO_NOTICE, finalApproval: false,
    status: incomeReview ? "needs_income_review" : offers.some(o => o.available) ? "demo_offers_available" : "no_demo_offer",
    requestedAmount, monthlyBudget, incomeStatus: incomeCheck?.status ?? "synthetic_bank_credits_only",
    affordability: { acceptedMonthlyIncome: income, existingMonthlyObligations: obligations,
      policyMonthlyLimit: policyLimit, effectiveMonthlyLimit: limit }, transactionFactor: transactions,
    factors, offers, requestedDocuments };
}
