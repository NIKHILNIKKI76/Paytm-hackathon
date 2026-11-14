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
    { id: "demo-partner-a", name: "Hero FinCorp", minimumScore: 720, maxAmount: 500000, annualRate: 14 },
    { id: "demo-partner-b", name: "Tata Capital", minimumScore: 660, maxAmount: 300000, annualRate: 19 },
    { id: "demo-partner-c", name: "Aditya Birla Capital", minimumScore: 620, maxAmount: 150000, annualRate: 24 },
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
  return {
    points, maximumPoints: 5 as const, eligibleMonthlyInflow: money(average), activeMonths,
    sentAmount: money(transactions.filter(t => t.direction === "debit").reduce((sum, t) => sum + t.amount, 0)),
    receivedAmount: money(transactions.filter(t => t.direction === "credit").reduce((sum, t) => sum + t.amount, 0)),
    explanation: "Recurring income and merchant receipts provide supporting cash-flow context. Self-transfers and refunds are excluded. Sending or spending more does not improve eligibility, and receipts are not counted twice as income."
  };
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
  const cardReserve = credit.accounts.filter(a => a.status === "active" && a.type === "credit_card")
    .reduce((sum, a) => sum + a.minimumMonthlyPayment, 0);
  const obligations = money(existingEmi + cardReserve);
  const policyLimit = floorMoney(Math.max(0, Math.min(income * DEMO_POLICY.maximumObligationRatio - obligations,
    income - obligations - profile.essentialMonthlyExpenses)));
  const limit = Math.min(policyLimit, monthlyBudget ?? Infinity);
  const factors: Factor[] = [];
  const add = (code: string, kind: Factor["kind"], explanation: string, evidence: string[], nextStep: string | null = null) =>
    factors.push({ code, kind, explanation, evidence, nextStep });
  add("CREDIT_SCORE", credit.score >= 720 ? "positive" : "limitation", `Your credit score is ${credit.score}.`,
    ["report.score"], credit.score < 720 ? "Review the report for errors and maintain timely repayments; no score improvement is guaranteed." : null);
  const late = credit.accounts.flatMap(a => a.payments.filter(p => p.daysPastDue > 0).map(p => `${a.id}:${p.month}`));
  add(late.length ? "LATE_PAYMENTS" : "ON_TIME_PAYMENTS", late.length ? "limitation" : "positive",
    late.length ? credit.accounts.filter(a => a.payments.some(p => p.daysPastDue > 0)).map(a =>
      `${a.lender} ${a.accountLabel.toLowerCase()}: late payments in ${a.payments.filter(p => p.daysPastDue > 0).map(p => p.month).join(", ")}.`).join(" ")
      : "All payments shown in your report were made on time.",
    late.length ? late : credit.accounts.map(a => a.id), late.length ? "Check the listed months and accounts; dispute errors with the lender/bureau." : null);
  const overdue = credit.summary.totalOverdues.amount;
  add(overdue ? "OVERDUES" : "NO_OVERDUES", overdue ? "limitation" : "positive",
    overdue ? `You have INR ${overdue} overdue: ${credit.accounts.filter(a => a.overdue > 0).map(a => `${a.lender} ${a.accountLabel.toLowerCase()}`).join(", ")}.` : "You have no reported overdue payments.", ["report.summary.totalOverdues"],
    overdue ? "Confirm the balance with the lender and discuss resolving genuine overdue amounts." : null);
  const usage = credit.summary.creditCard.utilizationPercent;
  add("CARD_UTILIZATION", usage <= 30 ? "positive" : "limitation", `You are using ${usage}% of your card limit: INR ${credit.summary.creditCard.outstanding} out of INR ${credit.summary.creditCard.limit}.`,
    ["report.summary.creditCard"], usage > 30 ? "Consider reducing revolving balances where affordable; do not borrow just to change utilization." : null);
  const enquiries = credit.enquiries.length;
  add("ENQUIRIES", enquiries <= 2 ? "positive" : "limitation", `${enquiries} hard enquiries are recorded between ${credit.enquiryWindow.start} and ${credit.enquiryWindow.end}.`,
    credit.enquiries.map(e => e.id), enquiries > 2 ? "Review unfamiliar enquiries and avoid unnecessary repeated applications. An enquiry is not automatically a mistake." : null);
  const closed = credit.accounts.filter(a => a.status === "closed" && a.outstanding === 0 && a.overdue === 0 && a.payments.every(p => p.daysPastDue === 0));
  if (closed.length) add("CLOSED_LOAN_REPAID", "positive", `You repaid and closed your ${closed.map(a => `${a.lender} ${a.accountLabel.toLowerCase()}`).join(", ")}; its recorded payments were on time.`, closed.map(a => a.id));
  add("ACCOUNT_AGE", "information", `Your oldest account is ${credit.summary.ageOfAccounts.oldestMonths} months old.`,
    ["report.summary.ageOfAccounts"], "Maintain accurate existing records; do not open loans solely to build account age.");
  add("AFFORDABILITY", policyLimit > 0 ? "information" : "limitation",
    `Monthly income considered: INR ${income}. Existing repayments: INR ${existingEmi} in loan EMIs plus INR ${cardReserve} in card minimum payments. Available for a new EMI: INR ${limit}.`,
    ["aaTransactions", "report.accounts", "demo_policy.maximumObligationRatio"],
    "Choose an EMI within your budget. Reducing obligations may help affordability but does not guarantee a larger offer.");
  add("TRANSACTION_CONTEXT", transactions.points > 0 ? "positive" : "information",
    `${transactions.activeMonths} months of eligible inflows appear in your transaction history. ${transactions.explanation}`, ["paytmTransactions"],
    "Relevant, consented transaction history may help a lender assess cash flow. More Paytm use or spending alone does not guarantee eligibility.");
  const stableIncome = Math.max(...salaryByMonth) > 0 && bankIncome / Math.max(...salaryByMonth) >= 0.8;
  if (!stableIncome) add("INCOME_VARIATION", "limitation", `Salary credits vary: ${DEMO_MONTHS.map((month, index) => `${month}: INR ${salaryByMonth[index]}`).join(", ")}. This assessment uses the lowest month, INR ${bankIncome}.`,
    ["aaTransactions"], "Provide recent salary-slip records and clarify any salary adjustments.");
  const incomeReview = incomeCheck?.status === "needs_review";
  if (incomeReview) add("INCOME_MISMATCH", "limitation", "Your salary-slip details do not yet match the bank records; offers are paused for clarification.",
    incomeCheck.issues.map(i => i.code), "Supply the missing or corrected records or clarify the mismatched salary credits.");

  const offers: LoanOffer[] = [];
  for (const lender of DEMO_POLICY.lenders) for (const tenure of DEMO_POLICY.tenures) {
    const blockers: Factor[] = [];
    const block = (code: string, explanation: string, evidence: string[]) => blockers.push({
      code, kind: "limitation", explanation,
      evidence, nextStep: "Review the supporting report entries and resolve incorrect or incomplete information."
    });
    if (credit.score < lender.minimumScore) block("BELOW_DEMO_SCORE", `Your score of ${credit.score} is below the ${lender.minimumScore} threshold used for this illustrative offer.`, ["report.score"]);
    if (overdue > 0) block("DEMO_OVERDUE_BLOCK", `Your INR ${overdue} overdue balance prevents a new offer in this assessment.`, ["report.summary.totalOverdues"]);
    if (!profile.residentIndian || profile.age < DEMO_POLICY.minAge || profile.age + tenure / 12 > DEMO_POLICY.maxAgeAtMaturity)
      block("DEMO_PRODUCT_REQUIREMENTS", "The residency or age-at-maturity condition for this assessment is not met.", ["profile.age", "profile.residentIndian"]);
    if (income < DEMO_POLICY.minimumIncome) block("DEMO_MINIMUM_INCOME", "Income considered is below the INR 15,000 minimum used in this assessment.", ["aaTransactions"]);
    if (incomeReview) block("INCOME_REVIEW_REQUIRED", "Salary details need clarification before an offer can be considered.", ["incomeCheck"]);
    // At most 5% uplift to a demo risk cap. Never changes score, affordability,
    // overdue blocks, or identity/product requirements.
    const riskCap = lender.maxAmount * (credit.score >= 750 ? 1 : credit.score >= 680 ? 0.65 : 0.35);
    const cappedAmount = Math.min(lender.maxAmount, riskCap * (1 + transactions.points / 100));
    const rate = lender.annualRate / 1200;
    const principalPerEmi = (1 - (1 + rate) ** -tenure) / rate;
    const affordablePrincipal = policyLimit * principalPerEmi;
    const budgetPrincipal = monthlyBudget === null ? null : monthlyBudget * principalPerEmi;
    const rawPrincipal = Math.min(requestedAmount, cappedAmount, affordablePrincipal, budgetPrincipal ?? Infinity);
    const principal = Math.floor(rawPrincipal / 1000) * 1000;
    const binding: LoanOffer["amountLimits"]["binding"] = [];
    if (rawPrincipal < requestedAmount) {
      if (budgetPrincipal !== null && budgetPrincipal <= rawPrincipal + 0.01 && monthlyBudget! < policyLimit) binding.push("monthly_budget");
      if (affordablePrincipal <= rawPrincipal + 0.01) binding.push("affordability");
      if (cappedAmount <= rawPrincipal + 0.01) binding.push(cappedAmount === lender.maxAmount ? "product_maximum" : "credit_profile_cap");
    }
    if (principal < rawPrincipal - 0.01 && !binding.length) binding.push("amount_rounding");
    if (principal < DEMO_POLICY.minimumOffer) block("NO_AFFORDABLE_DEMO_AMOUNT",
      requestedAmount < DEMO_POLICY.minimumOffer ? "The requested amount is below this product's INR 10,000 minimum."
        : `The monthly limit of INR ${limit} does not support the minimum INR 10,000 loan at this tenure.`, ["affordability"]);
    const available = blockers.length === 0;
    const emi = available ? calculateEmi(principal, lender.annualRate, tenure) : 0;
    const reasons = [...blockers];
    if (available && principal < requestedAmount) reasons.push({
      code: "LOWER_AMOUNT", kind: "limitation",
      explanation: `You requested INR ${requestedAmount}; the amount available is INR ${principal}. The binding limit is ${binding.join(" and ").replaceAll("_", " ")}.`,
      evidence: ["demo_policy", "affordability", "report.score", "paytmTransactions"],
      nextStep: "Compare smaller amounts or other tenures. Longer tenures can increase total interest; approval is never guaranteed."
    });
    const chance = !available || credit.score < 680 ? "low"
      : credit.score >= 750 && enquiries <= 2 && usage <= 30 && stableIncome ? "high" : "medium";
    reasons.push(...factors.filter(f => ["CREDIT_SCORE", "AFFORDABILITY", "ENQUIRIES", "CARD_UTILIZATION", "TRANSACTION_CONTEXT", "INCOME_VARIATION"].includes(f.code)));
    offers.push({
      id: `${lender.id}-${tenure}`, lender: lender.name, synthetic: true, policyId: DEMO_POLICY.id,
      available, chance, chanceMeaning: "Illustrative chance category, not a probability or promise of approval",
      amount: available ? principal : 0, annualInterestRate: lender.annualRate, tenureMonths: tenure,
      monthlyEmi: emi, totalRepayment: money(emi * tenure), totalInterest: available ? money(emi * tenure - principal) : 0,
      processingFee: 0, reasons, amountLimits: {
        productMaximum: lender.maxAmount, creditProfileCap: floorMoney(cappedAmount),
        affordabilityPrincipal: floorMoney(affordablePrincipal), budgetPrincipal: budgetPrincipal === null ? null : floorMoney(budgetPrincipal), binding
      }
    });
  }
  const requestedDocuments = incomeReview ? incomeCheck.requestedDocuments : !stableIncome
    ? ["Recent salary-slip records for 2026-08, 2026-09 and 2026-10 to clarify varying salary credits."] : [];
  return {
    synthetic: true, notice: DEMO_NOTICE, finalApproval: false,
    status: incomeReview ? "needs_income_review" : offers.some(o => o.available) ? "demo_offers_available" : "no_demo_offer",
    requestedAmount, monthlyBudget, incomeStatus: incomeCheck?.status ?? "synthetic_bank_credits_only",
    affordability: {
      acceptedMonthlyIncome: income, existingMonthlyObligations: obligations,
      policyMonthlyLimit: policyLimit, effectiveMonthlyLimit: limit, loanEmis: existingEmi,
      cardMinimumPayments: cardReserve, essentialMonthlyExpenses: profile.essentialMonthlyExpenses
    },
    evidence: {
      creditReport: credit,
      assessmentPolicy: { maximumObligationRatio: DEMO_POLICY.maximumObligationRatio, minimumIncome: DEMO_POLICY.minimumIncome,
        minimumLoanAmount: DEMO_POLICY.minimumOffer, amountIncrement: 1000, illustrative: true },
      income: {
        declaredMonthlyIncome: profile.monthlyIncome,
        employer: profile.employer, employmentMonths: profile.employmentMonths,
        salaryCredits: DEMO_MONTHS.map((month, index) => ({
          month, amount: salaryByMonth[index]!,
          transactionIds: profile.aaTransactions.filter(t => t.category === "salary" && t.direction === "credit" && t.counterparty === profile.employer && t.date.startsWith(month)).map(t => t.id)
        })),
        check: incomeCheck ?? null
      }, paytmTransactions: profile.paytmTransactions, bankTransactions: profile.aaTransactions
    }, transactionFactor: transactions,
    factors, offers, requestedDocuments
  };
}
