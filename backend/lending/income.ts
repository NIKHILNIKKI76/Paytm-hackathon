import { DEMO_MONTHS } from "./demo-data.ts";
import type { IncomeCheck, Profile, SalarySlip } from "./types.ts";
import { amount, InputError, object, textField } from "./validation.ts";

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function parseSalarySlips(value: unknown): SalarySlip[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6)
    throw new InputError("salarySlips must contain 1 to 6 structured salary-slip records.");
  return value.map(entry => {
    const slip = object(entry);
    const month = textField(slip.month, "month", 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new InputError("month must use YYYY-MM.");
    return { employeeName: textField(slip.employeeName, "employeeName"),
      employer: textField(slip.employer, "employer"), month,
      netSalary: amount(slip.netSalary, "netSalary") };
  });
}
// Compare structured extraction records to synthetic bank transactions. PDF/image
// extraction and real AA retrieval are deliberately not impersonated here.
export function crossCheckIncome(profile: Profile, slips: SalarySlip[]): IncomeCheck {
  const issues: IncomeCheck["issues"] = [];
  const add = (code: string, month: string | null, message: string) => issues.push({ code, month, message });
  const seen = new Set<string>();
  for (const slip of slips) {
    if (seen.has(slip.month)) add("DUPLICATE_MONTH", slip.month, "Provide one salary-slip record per month.");
    seen.add(slip.month);
    if (!DEMO_MONTHS.includes(slip.month as typeof DEMO_MONTHS[number]))
      add("OUTSIDE_BANK_PERIOD", slip.month, "This month is outside the synthetic bank-data period.");
    if (normalized(slip.employeeName) !== normalized(profile.customerName))
      add("NAME_MISMATCH", slip.month, "Employee name does not match the synthetic account holder.");
    if (normalized(slip.employer) !== normalized(profile.employer))
      add("EMPLOYER_MISMATCH", slip.month, "Employer does not match the synthetic salary source.");
    const credits = profile.aaTransactions.filter(transaction => transaction.direction === "credit"
      && transaction.category === "salary" && transaction.date.startsWith(slip.month)
      && normalized(transaction.counterparty) === normalized(slip.employer));
    const total = credits.reduce((sum, transaction) => sum + transaction.amount, 0);
    if (!credits.length) add("SALARY_CREDIT_NOT_FOUND", slip.month, "No matching synthetic salary credit was found.");
    else if (Math.abs(total - slip.netSalary) > 1)
      add("AMOUNT_MISMATCH", slip.month, "Net salary differs from matching synthetic credits by more than INR 1.");
  }
  for (const month of DEMO_MONTHS) if (!seen.has(month))
    add("MISSING_MONTH", month, `Provide the salary-slip record for ${month}.`);
  return { synthetic: true, status: issues.length ? "needs_review" : "matched_synthetic_credits",
    authenticityVerified: false,
    acceptedMonthlyIncome: issues.length ? null : Math.min(...slips.map(slip => slip.netSalary)),
    issues, requestedDocuments: issues.length
      ? ["Missing or corrected salary-slip records; employer clarification if a difference remains."] : [] };
}
