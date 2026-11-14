import { createHash } from "node:crypto";
import type { CreditAccount, Profile, Scenario, Transaction } from "./types.ts";

// Authored fixtures, never personal characteristics inferred from an identifier.
export const DEMO_AS_OF = "2026-11-14";
export const DEMO_MONTHS = ["2026-08", "2026-09", "2026-10"] as const;
export const SAMPLE_CUSTOMER = "Arjun Mehta";
export const SAMPLE_EMPLOYER = "Northstar Technologies Pvt Ltd";
export function selectScenario(pan: string, phone: string): Scenario {
  const index = createHash("sha256").update(`${pan}:${phone}`).digest()[0]! % 3;
  return (["strong", "moderate", "stressed"] as const)[index]!;
}
export function buildProfile(scenario: Scenario): Profile {
  const strong = scenario === "strong", moderate = scenario === "moderate", stressed = scenario === "stressed";
  const income = strong ? 60000 : moderate ? 40000 : 25000;
  const loanEmi = strong ? 0 : moderate ? 8000 : 12000;
  const cardBalance = strong ? 0 : moderate ? 18000 : 45000;
  const cardMinimum = cardBalance * 0.05;
  const loanPayments: CreditAccount["payments"] = DEMO_MONTHS.map((month, index) => ({
    month, dueDate: `${month}-05`, paidOn: `${month}-${stressed ? "25" : "05"}`,
    amountDue: loanEmi, amountPaid: stressed ? 10000 : loanEmi,
    overdueAtMonthEnd: stressed ? (index + 1) * 2000 : 0,
    // By month end, repayments have cleared prior arrears but part of this instalment remains.
    daysPastDue: stressed ? (index === 1 ? 25 : 26) : 0,
    paymentDelayDays: stressed ? 20 : 0,
  }));
  const cardPayments: CreditAccount["payments"] = DEMO_MONTHS.map((month, index) => ({
    month, dueDate: `${month}-20`, paidOn: cardMinimum ? `${month}-${stressed ? "28" : "18"}` : null,
    amountDue: cardMinimum, amountPaid: cardMinimum, overdueAtMonthEnd: 0,
    // Late but cleared before month end; no present overdue on the card.
    daysPastDue: 0, paymentDelayDays: stressed ? 8 : 0,
  }));
  const accounts: CreditAccount[] = [{
    id: "account-closed-1", lender: "HDFC Bank", accountLabel: "Personal loan ••4821",
    reportedOn: "2025-08-31", type: "personal_loan", status: "closed",
    openedOn: "2023-08-01", closedOn: "2025-08-05", sanctionedAmount: 80000,
    outstanding: 0, monthlyEmi: 0, creditLimit: 0, overdue: 0, minimumMonthlyPayment: 0,
    payments: ["2025-06", "2025-07", "2025-08"].map(month => ({ month, dueDate: `${month}-05`,
      paidOn: `${month}-05`, amountDue: 4000, amountPaid: 4000, overdueAtMonthEnd: 0, daysPastDue: 0, paymentDelayDays: 0 })),
  }, {
    id: "account-card-1", lender: "ICICI Bank", accountLabel: "Credit card ••9016",
    reportedOn: "2026-10-31", type: "credit_card", status: "active",
    openedOn: "2024-01-01", closedOn: null, sanctionedAmount: 0, outstanding: cardBalance,
    monthlyEmi: 0, creditLimit: 50000, overdue: 0, minimumMonthlyPayment: cardMinimum, payments: cardPayments,
  }];
  if (!strong) accounts.push({
    id: "account-loan-1", lender: "Axis Bank", accountLabel: "Personal loan ••6732",
    reportedOn: "2026-10-31", type: "personal_loan", status: "active",
    openedOn: "2025-05-01", closedOn: null, sanctionedAmount: 200000,
    outstanding: moderate ? 110000 : 150000, monthlyEmi: loanEmi,
    creditLimit: 0, overdue: stressed ? 6000 : 0, minimumMonthlyPayment: 0, payments: loanPayments,
  });
  const enquiryLenders = ["Hero FinCorp", "Tata Capital", "Aditya Birla Capital", "Axis Bank", "ICICI Bank", "IDFC FIRST Bank", "HDFC Bank"];
  const enquiries = Array.from({ length: strong ? 0 : moderate ? 3 : 7 }, (_, index) => ({
    id: `enquiry-${index + 1}`, lender: enquiryLenders[index]!,
    date: `2026-10-${String(index * 3 + 2).padStart(2, "0")}`, purpose: "personal_loan",
    requestedAmount: index % 2 ? 150000 : 200000, type: "hard" as const,
  }));
  const paytmTransactions: Transaction[] = [], aaTransactions: Transaction[] = [];
  for (const [index, month] of DEMO_MONTHS.entries()) {
    aaTransactions.push({ id: `aa-salary-${month}`, date: `${month}-28`, direction: "credit",
      amount: stressed && index === 1 ? 18000 : income, category: "salary", counterparty: SAMPLE_EMPLOYER });
    if (loanEmi) aaTransactions.push({ id: `aa-emi-${month}`, date: `${month}-${stressed ? "25" : "05"}`, direction: "debit",
      amount: stressed ? 10000 : loanEmi, category: "emi", counterparty: "Axis Bank" });
    if (cardMinimum) aaTransactions.push({ id: `aa-card-${month}`, date: `${month}-${stressed ? "28" : "18"}`, direction: "debit",
      amount: cardMinimum, category: "emi", counterparty: "ICICI Bank" });
    if (!stressed || index === 0) paytmTransactions.push({ id: `paytm-receipt-${month}`, date: `${month}-08`, direction: "credit",
      amount: strong ? 6000 : moderate ? 3000 : 1000, category: "merchant_receipt", counterparty: "Customer payment" });
    paytmTransactions.push({ id: `paytm-purchase-${month}`, date: `${month}-12`, direction: "debit",
      amount: strong ? 4000 : moderate ? 2500 : 1500, category: "purchase", counterparty: "Neighbourhood Store" },
    { id: `paytm-self-${month}`, date: `${month}-15`, direction: "credit", amount: 10000,
      category: "self_transfer", counterparty: "Own account transfer" });
  }
  const loans = accounts.filter(account => account.type === "personal_loan");
  const cards = accounts.filter(account => account.type === "credit_card");
  const oldest = accounts.map(account => account.openedOn).sort()[0]!;
  const oldestMonths = (Number(DEMO_AS_OF.slice(0, 4)) - Number(oldest.slice(0, 4))) * 12
    + Number(DEMO_AS_OF.slice(5, 7)) - Number(oldest.slice(5, 7));
  return {
    synthetic: true, scenario, age: 30, residentIndian: true, employmentMonths: 36,
    customerName: SAMPLE_CUSTOMER, employer: SAMPLE_EMPLOYER, monthlyIncome: income,
    essentialMonthlyExpenses: strong ? 20000 : moderate ? 15000 : 12000,
    report: {
      synthetic: true, provider: "Demo credit bureau (CIBIL-style; not issued by CIBIL)", asOf: DEMO_AS_OF,
      reportId: `CR-20261114-${scenario.toUpperCase()}`,
      enquiryWindow: { start: "2026-08-01", end: "2026-10-31" },
      score: strong ? 781 : moderate ? 690 : 590, scoreChange: strong ? 3 : moderate ? -5 : -20,
      scoreLabel: strong ? "very_good" : moderate ? "fair" : "needs_attention",
      summary: {
        loanAccounts: { outstanding: loans.reduce((sum, account) => sum + account.outstanding, 0),
          activeCount: loans.filter(account => account.status === "active").length,
          monthlyEmi: loans.reduce((sum, account) => sum + account.monthlyEmi, 0), rating: strong ? "excellent" : moderate ? "good" : "needs_attention" },
        creditCard: { utilizationPercent: cardBalance / 50000 * 100,
          outstanding: cards.reduce((sum, account) => sum + account.outstanding, 0), limit: 50000,
          rating: strong ? "excellent" : moderate ? "fair" : "needs_attention" },
        totalOverdues: { amount: accounts.reduce((sum, account) => sum + account.overdue, 0), rating: stressed ? "needs_attention" : "excellent" },
        ageOfAccounts: { oldestMonths, rating: "fair" },
        recentEnquiries: { count: enquiries.length, rating: strong ? "excellent" : moderate ? "fair" : "needs_attention" },
      }, accounts, enquiries,
    }, paytmTransactions, aaTransactions,
  };
}
