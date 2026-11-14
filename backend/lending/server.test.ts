import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createLendingServer } from "./server.ts";
import { DEMO_MONTHS } from "./demo-data.ts";

test("HTTP journey: create, expand report, filter budget, cross-check income, explain and expire", async t => {
  let now = Date.now();
  const server = createLendingServer({ now: () => now,
    rewrite: async () => "Synthetic demo: your existing obligations limit this offer." });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await post("/applications", {})).status, 400);
  const response = await post("/applications", { pan: "ABCDE1234F", phone: "9876543210", demoConsent: true,
    scenario: "moderate", requestedAmount: 200000 });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.text(); assert.ok(!raw.includes("ABCDE1234F")); assert.ok(!raw.includes("9876543210"));
  const application = JSON.parse(raw); const path = `/applications/${application.id}`;
  assert.equal(application.synthetic, true);
  assert.ok(application.creditReport.accounts.length > 0);
  assert.ok(application.creditReport.enquiries.length > 0);
  assert.equal((await fetch(`${base}${path}/credit-report`)).status, 200);
  assert.equal((await fetch(`${base}${path}/transactions`)).status, 200);
  assert.equal((await fetch(`${base}${path}/offers`)).status, 200);
  const budget = await (await post(`${path}/budget`, { monthlyBudget: 1500 })).json();
  assert.ok(budget.offers.filter((o: { available: boolean }) => o.available).every((o: { monthlyEmi: number }) => o.monthlyEmi <= 1500));
  assert.equal((await post(`${path}/budget`, { monthlyBudget: -1 })).status, 400);
  assert.equal((await post(`${path}/chat`, { question: "Explain", offerId: "unknown" })).status, 400);
  const chat = await (await post(`${path}/chat`, { question: "Why a smaller offer?", offerId: "demo-partner-b-24", useAi: true })).json();
  assert.equal(chat.source, "sarvam");
  assert.ok(chat.limitations.some((f: { code: string }) => f.code === "LOWER_AMOUNT"));
  const mismatch = await (await post(`${path}/income-check`, { salarySlips: DEMO_MONTHS.map(month => ({
    month, employeeName: "Demo Applicant", employer: "Demo Employer Pvt Ltd", netSalary: 99999 })) })).json();
  assert.equal(mismatch.assessment.status, "needs_income_review");
  const matched = await (await post(`${path}/income-check`, { salarySlips: DEMO_MONTHS.map(month => ({
    month, employeeName: "Demo Applicant", employer: "Demo Employer Pvt Ltd", netSalary: 40000 })) })).json();
  assert.equal(matched.incomeCheck.authenticityVerified, false);
  assert.equal(matched.assessment.status, "demo_offers_available");
  assert.equal((await post(`${path}/budget`, { monthlyBudget: null })).status, 200);
  assert.equal((await post("/applications", { demoConsent: true, pan: "ABCDE1234F", phone: "9876543210", scenario: "unknown" })).status, 400);
  const malformed = await fetch(`${base}/applications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await post("/applications", { text: "a".repeat(33000) })).status, 413);
  assert.equal((await fetch(`${base}${path}/budget`, { method: "DELETE" })).status, 405);
  now += 3600001;
  assert.equal((await fetch(`${base}${path}`)).status, 404);
});

test("missing Sarvam key never triggers an AI request", async t => {
  const server = createLendingServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const application = await (await post("/applications", { demoConsent: true, pan: "ABCDE1234F", phone: "9876543210" })).json();
  assert.equal((await post(`/applications/${application.id}/chat`, { question: "Why?", useAi: true })).status, 503);
  const local = await (await post(`/applications/${application.id}/chat`, { question: "Why?" })).json();
  assert.equal(local.source, "local_rules");
});
