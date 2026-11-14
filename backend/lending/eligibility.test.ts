import test from "node:test";
import assert from "node:assert/strict";
import { buildProfile, DEMO_MONTHS, selectScenario } from "./demo-data.ts";
import { assessEligibility, calculateEmi, transactionFactor } from "./eligibility.ts";
import { crossCheckIncome, parseSalarySlips } from "./income.ts";
import { explainAssessment, isUsableReply } from "./bot.ts";
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
  assert.ok(!/synthetic|demo-only|transaction factor|positive credit behaviour/i.test(result.answer));
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
  assert.ok(fallback.aiNotice.includes("unavailable"));
});

test("complete evidence reconciles payments, bank debits, arrears and card minimums", () => {
  for (const scenario of ["strong", "moderate", "stressed"] as Scenario[]) {
    const profile = buildProfile(scenario);
    for (const account of profile.report.accounts) {
      let carriedOverdue = 0;
      for (const payment of account.payments) {
        carriedOverdue = Math.max(0, carriedOverdue + payment.amountDue - payment.amountPaid);
        assert.equal(payment.overdueAtMonthEnd, carriedOverdue);
        if (account.status === "active" && payment.amountPaid) {
          const debit = profile.aaTransactions.find(t => t.direction === "debit" && t.counterparty === account.lender && t.date === payment.paidOn);
          assert.equal(debit?.amount, payment.amountPaid);
        }
      }
      assert.equal(account.overdue, account.payments.at(-1)!.overdueAtMonthEnd);
    }
    const assessment = assessEligibility(profile, 200000);
    assert.equal(assessment.affordability.cardMinimumPayments,
      profile.report.accounts.filter(a => a.type === "credit_card").reduce((sum, a) => sum + a.minimumMonthlyPayment, 0));
    assert.equal(assessment.evidence.income.salaryCredits.length, 3);
    assert.equal(assessment.evidence.creditReport.reportId, profile.report.reportId);
  }
});
test("rejected-profile reply is concise and names the actual report problems", async () => {
  const assessment = assessEligibility(buildProfile("stressed"), 200000);
  const result = await explainAssessment(assessment, "Why didn't I get a loan?");
  for (const value of ["₹6,000", "₹14,250", "₹18,000", "Aug 2026", "Oct 2026", "90%"]) assert.ok(result.answer.includes(value), value);
  assert.match(result.answer, /Sep(?:t)? 2026/);
  assert.ok(result.answer.split(/\s+/).length < 160);
  assert.ok(!/synthetic|demo|account-card-|account-loan-|none identified|positive credit behaviour|transaction factor/i.test(result.answer));
});
test("positive reply recognizes a repaid loan even in a currently stressed profile", async () => {
  const result = await explainAssessment(assessEligibility(buildProfile("stressed"), 200000), "What did I do correctly?");
  assert.ok(result.answer.includes("HDFC Bank"));
  assert.ok(result.answer.includes("closed"));
  assert.ok(!result.answer.includes("no reported overdues"));
});
test("a reduced offer caused by customer budget is not blamed on poor credit", async () => {
  const assessment = assessEligibility(buildProfile("strong"), 200000, 2000);
  const selected = assessment.offers.find(o => o.id === "demo-partner-a-24")!;
  assert.deepEqual(selected.amountLimits.binding, ["monthly_budget"]);
  const result = await explainAssessment(assessment, "Why is my offer lower?", selected.id);
  assert.ok(result.answer.includes("Your chosen ₹2,000 monthly budget is the main limit"));
  assert.ok(!/late payments|overdue|recent enquiries|poor credit/.test(result.answer));
});
test("product maximum is distinct from customer mistakes", async () => {
  const assessment = assessEligibility(buildProfile("strong"), 1000000);
  const selected = assessment.offers.find(o => o.id === "demo-partner-a-36")!;
  assert.deepEqual(selected.amountLimits.binding, ["product_maximum"]);
  const result = await explainAssessment(assessment, "Why less?", selected.id);
  assert.ok(result.answer.includes("₹5,00,000"));
  assert.ok(result.answer.includes("product"));
  assert.ok(!result.answer.includes("below"));
});
test("credit-profile cap and affordability expose their distinct limiting amounts", () => {
  const profile = buildProfile("moderate");
  const limitedByRepayments = assessEligibility(profile, 500000).offers.find(o => o.id === "demo-partner-b-36")!;
  assert.ok(limitedByRepayments.amountLimits.binding.includes("affordability"));
  for (const account of profile.report.accounts) account.monthlyEmi = 0;
  profile.report.summary.loanAccounts.monthlyEmi = 0;
  const limitedByCredit = assessEligibility(profile, 500000).offers.find(o => o.id === "demo-partner-b-36")!;
  assert.deepEqual(limitedByCredit.amountLimits.binding, ["credit_profile_cap"]);
  assert.equal(limitedByCredit.amountLimits.creditProfileCap, 204750);
});
test("an unavailable selected offer uses its actual blocker, not unrelated risk observations", async () => {
  const result = await explainAssessment(assessEligibility(buildProfile("moderate"), 200000), "Why no offer?", "demo-partner-a-24");
  assert.ok(result.answer.includes("690")); assert.ok(result.answer.includes("720"));
  assert.ok(result.decision.primaryReasonCodes.includes("BELOW_DEMO_SCORE"));
  assert.ok(!result.answer.includes("because your card"));
});
test("tiny requested amount is explained as a product minimum, not bad credit", async () => {
  const result = await explainAssessment(assessEligibility(buildProfile("strong"), 9999), "Why no loan?");
  assert.ok(result.answer.includes("10,000 minimum"));
  assert.ok(!/late payments|overdues|below.*score|credit score.*does not/.test(result.answer));
});
test("AI gets complete report and bank evidence, not just an abbreviated factor list", async () => {
  const assessment = assessEligibility(buildProfile("stressed"), 200000);
  await explainAssessment(assessment, "Why no offer?", undefined, async raw => {
    const facts = JSON.parse(raw);
    assert.equal(facts.creditReport.accounts.length, 3);
    assert.equal(facts.creditReport.enquiries.length, 7);
    assert.equal(facts.incomeEvidence.salaryCredits[1].amount, 18000);
    assert.equal(facts.affordability.existingMonthlyObligations, 14250);
    assert.ok(facts.creditReport.accounts[2].payments.every((p: { amountDue: number; amountPaid: number }) => p.amountDue === 12000 && p.amountPaid === 10000));
    assert.ok(facts.bankTransactions.length >= 6);
    assert.ok(facts.decision.conciseAnswer.includes("₹6,000"));
    return facts.decision.conciseAnswer;
  });
});

test("AI handles greetings without being forced into an eligibility diagnosis", async () => {
  let called = false;
  const result = await explainAssessment(assessEligibility(buildProfile("strong"), 2000000), "hiii", undefined, async () => { called = true; return "Hi! How can I help?"; });
  assert.equal(called, true);
  assert.match(result.answer, /^Hi!/);
  assert.ok(!/5,00,000|income|product maximum/.test(result.answer));
});

test("lender questions compare all lenders even when an unavailable offer is selected", async () => {
  const assessment = assessEligibility(buildProfile("moderate"), 200000);
  const result = await explainAssessment(assessment, "which lenders can give me a loan", "demo-partner-a-24");
  assert.match(result.answer, /Tata Capital/);
  assert.match(result.answer, /Aditya Birla Capital/);
  assert.ok(!result.answer.includes("This offer isn't available"));
  const unavailable = await explainAssessment(assessment, "which lenders are not giving me loan", "demo-partner-b-24");
  assert.match(unavailable.answer, /Hero FinCorp/);
  assert.match(unavailable.answer, /720/);
  const none = await explainAssessment(assessEligibility(buildProfile("stressed"), 200000), "which lenders can give me a loan", "demo-partner-a-24");
  for (const lender of ["Hero FinCorp", "Tata Capital", "Aditya Birla Capital"]) assert.ok(none.answer.includes(lender));
  assert.match(none.answer, /None/);
});

test("mistake questions explain actual payment records instead of repeating offer minimums", async () => {
  const answer = await explainAssessment(assessEligibility(buildProfile("stressed"), 200000), "what mistake i did", "demo-partner-a-24");
  assert.match(answer.answer, /Axis Bank/);
  assert.match(answer.answer, /12,000/);
  assert.match(answer.answer, /10,000/);
  assert.ok(!answer.answer.includes("minimum"));
});

test("increasing borrowing access addresses the binding limit and keeps exact tenure and amount", async () => {
  const assessment = assessEligibility(buildProfile("strong"), 2000000);
  const offer = assessment.offers.find(o => o.id === "demo-partner-a-24")!;
  const result = await explainAssessment(assessment, "how to increase my debt access", offer.id);
  assert.match(result.answer, /Higher verified recurring income or lower existing monthly repayments/);
  assert.ok(result.answer.includes(new Intl.NumberFormat("en-IN", {style:"currency",currency:"INR",maximumFractionDigits:0}).format(offer.amount)));
  assert.match(result.answer, /24 months/);
  assert.ok(!/product is capped|5,00,000/.test(result.answer));
  const budgetResult = await explainAssessment(assessEligibility(buildProfile("strong"), 2000000, 2000), "how to increase my debt access", offer.id);
  assert.match(budgetResult.answer, /chosen monthly budget/);
  assert.ok(!budgetResult.answer.includes("Higher verified recurring income"));
});

test("AI wording checks reject internal codes, real-approval language and wrong budget attribution", () => {
  const assessment = assessEligibility(buildProfile("strong"), 200000, 2000);
  const offer = assessment.offers.find(o => o.id === "demo-partner-a-24")!;
  assert.equal(isUsableReply("Your sanctioned amount is INR 41,000.", assessment, offer), false);
  assert.equal(isUsableReply("The reason is monthly_budget.", assessment, offer), false);
  assert.equal(isUsableReply("Your income leaves only INR 2,000 for repayment.", assessment, offer), false);
  assert.equal(isUsableReply("Your income is INR 60,000, leaving only INR 2,000 available.", assessment, offer), false);
  assert.equal(isUsableReply("Your chosen INR 2,000 monthly budget limits this offer. You can compare a different tenure and its total interest.", assessment, offer), true);
  const rejected = assessEligibility(buildProfile("stressed"), 200000);
  assert.equal(isUsableReply("A longer tenure will solve this.", rejected), false);
});
