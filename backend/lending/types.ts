export const DEMO_NOTICE = "Synthetic demo only: no real CIBIL, Paytm, bank, AA verification or lender approval.";
export type Scenario = "strong" | "moderate" | "stressed";
export type Rating = "excellent" | "good" | "fair" | "needs_attention";
export interface CreditAccount {
  id: string;
  lender: string;
  type: "personal_loan" | "credit_card";
  status: "active" | "closed";
  openedOn: string;
  closedOn: string | null;
  sanctionedAmount: number;
  outstanding: number;
  monthlyEmi: number;
  creditLimit: number;
  overdue: number;
  payments: { month: string; daysPastDue: number }[];
}
export interface Transaction {
  id: string;
  date: string;
  direction: "credit" | "debit";
  amount: number;
  category: "salary" | "merchant_receipt" | "purchase" | "self_transfer" | "refund" | "emi";
  counterparty: string;
}
export interface CreditReport {
  synthetic: true;
  provider: "Demo credit bureau (CIBIL-style; not issued by CIBIL)";
  asOf: string;
  score: number;
  scoreChange: number;
  scoreLabel: string;
  summary: {
    loanAccounts: { outstanding: number; activeCount: number; monthlyEmi: number; rating: Rating };
    creditCard: { utilizationPercent: number; outstanding: number; limit: number; rating: Rating };
    totalOverdues: { amount: number; rating: Rating };
    ageOfAccounts: { oldestMonths: number; rating: Rating };
    recentEnquiries: { count: number; rating: Rating };
  };
  accounts: CreditAccount[];
  enquiries: { id: string; lender: string; date: string; purpose: string; type: "hard" }[];
}
export interface Profile {
  synthetic: true;
  scenario: Scenario;
  age: number;
  residentIndian: boolean;
  employmentMonths: number;
  customerName: string;
  employer: string;
  monthlyIncome: number;
  essentialMonthlyExpenses: number;
  report: CreditReport;
  paytmTransactions: Transaction[];
  aaTransactions: Transaction[];
}
export interface Factor {
  code: string;
  kind: "positive" | "limitation" | "information";
  explanation: string;
  evidence: string[];
  nextStep: string | null;
}
export interface LoanOffer {
  id: string;
  lender: string;
  synthetic: true;
  policyId: string;
  available: boolean;
  chance: "high" | "medium" | "low";
  chanceMeaning: "Demo category, not a probability or promise of approval";
  amount: number;
  annualInterestRate: number;
  tenureMonths: number;
  monthlyEmi: number;
  totalRepayment: number;
  totalInterest: number;
  processingFee: 0;
  reasons: Factor[];
}
export interface Assessment {
  synthetic: true;
  notice: string;
  finalApproval: false;
  status: "demo_offers_available" | "no_demo_offer" | "needs_income_review";
  requestedAmount: number;
  monthlyBudget: number | null;
  incomeStatus: "synthetic_bank_credits_only" | "matched_synthetic_credits" | "needs_review";
  affordability: {
    acceptedMonthlyIncome: number;
    existingMonthlyObligations: number;
    policyMonthlyLimit: number;
    effectiveMonthlyLimit: number;
  };
  transactionFactor: { points: number; maximumPoints: 5; eligibleMonthlyInflow: number; activeMonths: number; sentAmount: number; receivedAmount: number; explanation: string };
  factors: Factor[];
  offers: LoanOffer[];
  requestedDocuments: string[];
}
export interface SalarySlip {
  employeeName: string;
  employer: string;
  month: string;
  netSalary: number;
}
export interface IncomeCheck {
  synthetic: true;
  status: "matched_synthetic_credits" | "needs_review";
  authenticityVerified: false;
  acceptedMonthlyIncome: number | null;
  issues: { code: string; month: string | null; message: string }[];
  requestedDocuments: string[];
}
