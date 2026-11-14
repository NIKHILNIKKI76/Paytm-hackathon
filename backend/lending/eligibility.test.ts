import test from "node:test";
import assert from "node:assert/strict";
import { buildProfile, DEMO_MONTHS, selectScenario } from "./demo-data.ts";
import { assessEligibility, calculateEmi, transactionFactor } from "./eligibility.ts";
import { crossCheckIncome, parseSalarySlips } from "./income.ts";
import { explainAssessment } from "./bot.ts";
import { identity } from "./validation.ts";
import type { Profile, Scenario } from "./types.ts";

const slipsFor = (profile: Profile) => DEMO_MONTHS.map(month => ({ month,
  employeeName: profile.customerName, employer: profile.employer, netSalary: profile.monthlyIncome }));
test("identity selects a repeatable synthetic scenario, not an actual credit lookup", () => {
  assert.equal(selectScenario("ABCDE1234F", "9876543210"), selectScenario("ABCDE1234F", "9876543210"));
  assert.deepEqual(identity({ pan: "abcde1234f", phone: "9876543210" }), { pan: "ABCDE1234F", phone: "9876543210" });
  for (const input of [{ pan: "bad", phone: "9876543210" }, { pan: "ABCDE1234F", phone: "1234567890" }, { pan: 1, phone: "9876543210" }])
    assert.throws(() => identity(input));
});
test("report summary reconciles with account details for every scenario", () => {
  for (const scenario of ["strong", "moderate", "stressed"] as Scenario[]) {
    const report = buildProfile(scenario).report;
    assert.equal(report.summary.loanAccounts.outstanding, report.accounts.filter(a => a.type === "personal_loan").reduce((sum, a) => sum + a.outstanding, 0));
    assert.equal(report.summary.totalOverdues.amount, report.accounts.reduce((sum, a) => sum + a.overdue, 0));
    assert.equal(report.summary.recentEnquiries.count, report.enquiries.length);
    assert.equal(report.synthetic, true);
  }
  const report = buildProfile("strong").report;
  assert.equal(report.score, 781);
  assert.equal(report.summary.loanAccounts.outstanding, 0);
  assert.equal(report.summary.creditCard.utilizationPercent, 0);
  assert.equal(report.summary.ageOfAccounts.rating, "fair");
});
test("all three chance categories and no-offer outcomes are represented", () => {
  assert.ok(assessEligibility(buildProfile("strong"), 200000).offers.some(o => o.available && o.chance === "high"));
  assert.ok(assessEligibility(buildProfile("moderate"), 200000).offers.some(o => o.available && o.chance === "medium"));
  const denied = assessEligibility(buildProfile("stressed"), 200000);
  assert.equal(denied.status, "no_demo_offer");
  assert.ok(denied.offers.every(o => !o.available && o.amount === 0 && o.chance === "low"));
  assert.equal(denied.finalApproval, false);
});
test("transaction points are bounded and ignore spending, refunds and self transfers", () => {
  const profile = buildProfile("strong");
  const factor = transactionFactor(profile.paytmTransactions);
  assert.equal(factor.points, 5);
  const noisy = [...profile.paytmTransactions, ...Array.from({ length: 100 }, (_, i) => ({
    id: `noise-${i}`, date: "2026-10-10", direction: "credit" as const, amount: 999999,
    category: "self_transfer" as const, counterparty: "Own account",
  })), { id: "refund", date: "2026-10-10", direction: "credit" as const, amount: 999999,
    category: "refund" as const, counterparty: "Demo Refund" }];
  assert.equal(transactionFactor(noisy).points, factor.points);
  assert.equal(transactionFactor(noisy.map(t => ({ ...t, direction: "debit" }))).points, 0);
  assert.equal(transactionFactor([]).points, 0);
});
test("transaction activity cannot override hard criteria or increase accepted bank income", () => {
  const profile = buildProfile("stressed");
  profile.paytmTransactions = buildProfile("strong").paytmTransactions;
  const result = assessEligibility(profile, 200000);
  assert.equal(result.transactionFactor.points, 5);
  assert.equal(result.status, "no_demo_offer");
  assert.equal(result.affordability.acceptedMonthlyIncome, 18000);
});
test("low score can yield low-chance demo offers without pretending it is a probability", () => {
  const profile = buildProfile("strong"); profile.report.score = 640;
  const result = assessEligibility(profile, 150000);
  assert.ok(result.offers.some(o => o.available && o.chance === "low"));
  assert.ok(result.offers.filter(o => o.available).every(o => o.chanceMeaning.includes("not a probability")));
});
test("offers respect both user budget and policy capacity across varied requests", () => {
  for (const scenario of ["strong", "moderate", "stressed"] as Scenario[]) {
    for (const budget of [1, 500, 1234.56, 3000, 10000, 1000000]) {
      for (const requested of [9999, 10000, 100000, 1000000]) {
        const result = assessEligibility(buildProfile(scenario), requested, budget);
        for (const offer of result.offers.filter(o => o.available)) {
          assert.ok(offer.monthlyEmi <= budget);
          assert.ok(offer.monthlyEmi <= result.affordability.policyMonthlyLimit);
          assert.ok(offer.amount <= requested);
          assert.ok(Math.abs(offer.totalRepayment - offer.monthlyEmi * offer.tenureMonths) < 0.01);
          assert.ok(Math.abs(offer.totalInterest - (offer.totalRepayment - offer.amount)) < 0.01);
        }
      }
    }
  }
});
test("smaller budget cannot increase available amount for the same offer", () => {
  const profile = buildProfile("strong");
  const normal = assessEligibility(profile, 500000);
  const reduced = assessEligibility(profile, 500000, 2000);
  for (const offer of reduced.offers) assert.ok(offer.amount <= normal.offers.find(o => o.id === offer.id)!.amount);
  assert.ok(reduced.offers.some(o => o.reasons.some(r => r.code === "LOWER_AMOUNT")));
});
test("EMI math supports zero interest and rejects invalid inputs", () => {
  assert.equal(calculateEmi(12000, 0, 12), 1000);
  assert.ok(Math.abs(calculateEmi(100000, 12, 12) - 8884.88) < 0.02);
  assert.throws(() => calculateEmi(0, 12, 12));
  assert.throws(() => calculateEmi(10000, -1, 12));
  assert.throws(() => calculateEmi(10000, 12, 1.5));
  for (const invalid of [NaN, Infinity, -1, 0, 1.234]) assert.throws(() => assessEligibility(buildProfile("strong"), 10000, invalid));
});
test("matching salary records corroborate synthetic credits, not authenticity", () => {
  const profile = buildProfile("strong");
  const check = crossCheckIncome(profile, parseSalarySlips(slipsFor(profile)));
  assert.equal(check.status, "matched_synthetic_credits");
  assert.equal(check.authenticityVerified, false);
  assert.equal(assessEligibility(profile, 200000, null, check).incomeStatus, "matched_synthetic_credits");
});
test("salary mismatches pause offers and request specific corrections", () => {
  const profile = buildProfile("strong");
  const slips = slipsFor(profile); slips[0]!.netSalary += 5000;
  const check = crossCheckIncome(profile, slips);
  assert.ok(check.issues.some(i => i.code === "AMOUNT_MISMATCH" && i.month === "2026-08"));
  const result = assessEligibility(profile, 200000, null, check);
  assert.equal(result.status, "needs_income_review");
  assert.ok(result.offers.every(o => !o.available));
});
test("missing months, duplicates, wrong identity and out-of-period records need review", () => {
  const profile = buildProfile("strong"); const slip = slipsFor(profile)[0]!;
  const check = crossCheckIncome(profile, [slip, slip, { ...slip, month: "2025-01", employeeName: "Other", employer: "Other" }]);
  for (const code of ["DUPLICATE_MONTH", "MISSING_MONTH", "NAME_MISMATCH", "EMPLOYER_MISMATCH", "OUTSIDE_BANK_PERIOD"])
    assert.ok(check.issues.some(issue => issue.code === code));
  assert.throws(() => parseSalarySlips([{ ...slip, month: "2026-13" }]));
  assert.throws(() => parseSalarySlips([{ ...slip, netSalary: "60000" }]));
});
test("bot exposes deterministic reasons and does not invent screenshot risk factors", async () => {
  const result = await explainAssessment(assessEligibility(buildProfile("strong"), 200000), "Why this offer?");
  assert.equal(result.source, "local_rules");
  assert.ok(result.strengths.some(f => f.code === "NO_OVERDUES"));
  assert.ok(!result.limitations.some(f => ["OVERDUES", "LATE_PAYMENTS", "ENQUIRIES"].includes(f.code)));
  assert.ok(result.answer.includes("does not guarantee eligibility"));
  await assert.rejects(() => explainAssessment(assessEligibility(buildProfile("strong"), 200000), "Why?", "missing"));
});
test("AI receives decision facts without identifiers; failures are labelled", async () => {
  const assessment = assessEligibility(buildProfile("moderate"), 200000);
  const result = await explainAssessment(assessment, "My PAN ABCDE1234F and phone 9876543210", undefined,
    async (facts, question) => {
      assert.ok(!facts.includes("ABCDE1234F")); assert.ok(!question.includes("9876543210"));
      assert.ok(!question.includes("ABCDE1234F")); return "Synthetic explanation";
    });
  assert.equal(result.source, "sarvam");
  const fallback = await explainAssessment(assessment, "Why?", undefined, async () => { throw new Error("provider failure"); });
  assert.equal(fallback.source, "local_fallback");
  assert.ok(fallback.aiNotice.includes("failed"));
});
