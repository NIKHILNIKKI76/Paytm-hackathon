import { createHash } from "node:crypto";
import type { CreditAccount, Profile, Scenario, Transaction } from "./types.ts";

// Fixed reference date keeps examples reproducible. These are authored scenarios,
// not personal characteristics inferred from an identifier.
export const DEMO_AS_OF = "2026-11-14";
export const DEMO_MONTHS = ["2026-08", "2026-09", "2026-10"] as const;
export function selectScenario(pan: string, phone: string): Scenario {
  const index = createHash("sha256").update(`${pan}:${phone}`).digest()[0]! % 3;
  return (["strong", "moderate", "stressed"] as const)[index]!;
}
export function buildProfile(scenario: Scenario): Profile {
  const strong = scenario === "strong";
  const moderate = scenario === "moderate";
  const income = strong ? 60000 : moderate ? 40000 : 25000;
  const loanEmi = strong ? 0 : moderate ? 8000 : 12000;
  const cardBalance = strong ? 0 : moderate ? 18000 : 45000;
  const overdue = strong || moderate ? 0 : 6000;
  const payments = DEMO_MONTHS.map(month => ({ month, daysPastDue: strong || moderate ? 0 : 30 }));
  const accounts: CreditAccount[] = [{
    id: "account-closed-1", lender: "Demo Historical Lender", type: "personal_loan", status: "closed",
    openedOn: "2023-08-01", closedOn: "2025-08-01", sanctionedAmount: 80000,
    outstanding: 0, monthlyEmi: 0, creditLimit: 0, overdue: 0,
    payments: [{ month: "2025-06", daysPastDue: 0 }, { month: "2025-07", daysPastDue: 0 }],
  }, {
    id: "account-card-1", lender: "Demo Card Issuer", type: "credit_card", status: "active",
    openedOn: "2024-01-01", closedOn: null, sanctionedAmount: 0, outstanding: cardBalance,
    monthlyEmi: 0, creditLimit: 50000, overdue: 0, payments: structuredClone(payments),
  }];
  if (!strong) accounts.push({
    id: "account-loan-1", lender: "Demo Existing Lender", type: "personal_loan", status: "active",
    openedOn: "2025-05-01", closedOn: null, sanctionedAmount: 200000,
    outstanding: moderate ? 110000 : 150000, monthlyEmi: loanEmi,
    creditLimit: 0, overdue, payments: structuredClone(payments),
  });
  const enquiries = Array.from({ length: strong ? 0 : moderate ? 3 : 7 }, (_, index) => ({
    id: `enquiry-${index + 1}`, lender: `Demo Enquiry Lender ${index + 1}`,
    date: `2026-10-${String(index + 2).padStart(2, "0")}`, purpose: "personal_loan", type: "hard" as const,
  }));
  const paytmTransactions: Transaction[] = [];
  const aaTransactions: Transaction[] = [];
  for (const [monthIndex, month] of DEMO_MONTHS.entries()) {
    aaTransactions.push({ id: `aa-salary-${month}`, date: `${month}-28`, direction: "credit",
      amount: scenario === "stressed" && monthIndex === 1 ? 18000 : income,
      category: "salary", counterparty: "Demo Employer Pvt Ltd" });
    if (loanEmi) aaTransactions.push({ id: `aa-emi-${month}`, date: `${month}-05`, direction: "debit",
      amount: loanEmi, category: "emi", counterparty: "Demo Existing Lender" });
    // Irregular inflows provide a contrasting demo; volume alone never adds points.
    if (strong || moderate || monthIndex === 0) {
      paytmTransactions.push({ id: `paytm-receipt-${month}`, date: `${month}-08`, direction: "credit",
        amount: strong ? 6000 : moderate ? 3000 : 1000,
        category: "merchant_receipt", counterparty: "Demo Customer" });
    }
    paytmTransactions.push({ id: `paytm-purchase-${month}`, date: `${month}-12`, direction: "debit",
      amount: strong ? 4000 : moderate ? 2500 : 1500, category: "purchase", counterparty: "Demo Shop" },
    { id: `paytm-self-${month}`, date: `${month}-15`, direction: "credit", amount: 10000,
      category: "self_transfer", counterparty: "Demo Own Account" });
  }
  return {
    synthetic: true, scenario, age: 30, residentIndian: true, employmentMonths: 36,
    customerName: "Demo Applicant", employer: "Demo Employer Pvt Ltd", monthlyIncome: income,
    essentialMonthlyExpenses: strong ? 20000 : moderate ? 15000 : 12000,
    report: {
      synthetic: true, provider: "Demo credit bureau (CIBIL-style; not issued by CIBIL)", asOf: DEMO_AS_OF,
      score: strong ? 781 : moderate ? 690 : 590, scoreChange: strong ? 3 : moderate ? -5 : -20,
      scoreLabel: strong ? "very_good" : moderate ? "fair" : "needs_attention",
      summary: {
        loanAccounts: { outstanding: strong ? 0 : moderate ? 110000 : 150000,
          activeCount: strong ? 0 : 1, monthlyEmi: loanEmi, rating: strong ? "excellent" : moderate ? "good" : "needs_attention" },
        creditCard: { utilizationPercent: cardBalance / 50000 * 100, outstanding: cardBalance, limit: 50000,
          rating: strong ? "excellent" : moderate ? "fair" : "needs_attention" },
        totalOverdues: { amount: overdue, rating: overdue ? "needs_attention" : "excellent" },
        ageOfAccounts: { oldestMonths: 39, rating: "fair" },
        recentEnquiries: { count: enquiries.length, rating: strong ? "excellent" : moderate ? "fair" : "needs_attention" },
      }, accounts, enquiries,
    }, paytmTransactions, aaTransactions,
  };
}
