import type { Assessment, CreditReport, Factor, IncomeCheck, LoanOffer, Transaction } from "../../backend/lending/types.ts";

interface ApplicationData {
  id: string; synthetic: true; expiresAt: string;
  customer: { name: string; maskedPan: string; maskedPhone: string; scenario: string };
  creditReport: CreditReport;
  paytmHistory: { transactions: Transaction[] };
  aaData: { accountHolder: string; employer: string; transactions: Transaction[] };
  assessment: Assessment;
}
interface Explanation {
  answer: string; source: "sarvam" | "local_rules" | "local_fallback";
  strengths: Factor[]; limitations: Factor[]; nextSteps: string[];
}
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing page element: ${selector}`);
  return element;
};
const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const preciseCurrency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => currency.format(value);
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
const date = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const month = (value: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
let application: ApplicationData | null = null;
let selectedTenure = 24;
let selectedOfferId: string | undefined;
let mutationPending = false;
let chatPending = false;
let generation = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
class ApiError extends Error { status = 0; }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  if (!response.ok) {
    const error = new ApiError(response.status === 404 && application
      ? "Your session has expired. Start a new profile to continue." : result.error ?? "The request could not be completed.");
    error.status = response.status; throw error;
  }
  return result as T;
}
function showToast(message: string) {
  const toast = $("#toast"); toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}
function errorText(error: unknown) {
  return error instanceof Error ? error.name === "TimeoutError" ? "This is taking longer than expected. Please try again." : error.message : "Something went wrong. Please try again.";
}
async function mutation(form: HTMLFormElement, feedback: HTMLElement, action: () => Promise<void>) {
  if (mutationPending) return;
  mutationPending = true; feedback.textContent = "";
  const controls = [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")];
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  controls.forEach(control => { control.disabled = true; }); button?.classList.add("loading-button"); form.setAttribute("aria-busy", "true");
  try { await action(); } catch (error) { feedback.textContent = errorText(error); }
  finally { controls.forEach(control => { control.disabled = false; }); button?.classList.remove("loading-button"); form.removeAttribute("aria-busy"); mutationPending = false; }
}
function setAssessment(assessment: Assessment) {
  if (!application) return;
  application.assessment = assessment;
  renderAssessment();
  if ($<HTMLDialogElement>("#chat-dialog").open) {
    renderChatContext();
    addMessage("assistant", "Your offer figures have been updated. Ask again to get an explanation of the current assessment.", "Offers refreshed");
  }
}

$("#sample-details").addEventListener("click", () => {
  $<HTMLInputElement>("#pan").value = "ABCDE1234F";
  $<HTMLInputElement>("#phone").value = "9876543210";
  if (!$<HTMLSelectElement>("#scenario").value) $<HTMLSelectElement>("#scenario").value = "moderate";
  $("#demo-consent").focus();
});
$("#application-form").addEventListener("submit", event => {
  event.preventDefault(); const form = event.currentTarget as HTMLFormElement;
  const payload = { pan: $<HTMLInputElement>("#pan").value.trim().toUpperCase(),
    phone: $<HTMLInputElement>("#phone").value.trim(), demoConsent: $<HTMLInputElement>("#demo-consent").checked,
    requestedAmount: Number($<HTMLInputElement>("#requested").value),
    ...($<HTMLSelectElement>("#scenario").value ? { scenario: $<HTMLSelectElement>("#scenario").value } : {}) };
  void mutation(form, $("#application-error"), async () => {
    application = await api<ApplicationData>("/applications", payload); generation++;
    $<HTMLInputElement>("#available-only").checked = false;
    for (const selector of ["#budget-error", "#income-error", "#chat-error"]) $(selector).textContent = "";
    $<HTMLInputElement>("#pan").value = ""; $<HTMLInputElement>("#phone").value = "";
    selectedOfferId = undefined; selectedTenure = 24; $("#chat-messages").replaceChildren();
    $("#welcome").hidden = true; $("#dashboard").hidden = false; $("#floating-chat").hidden = false;
    $("#customer-line").textContent = `${application.customer.name} · PAN ${application.customer.maskedPan} · +91 ${application.customer.maskedPhone}`;
    renderCredit(); renderAssessment(); window.scrollTo({ top: 0, behavior: "smooth" });
    $("#offers-title").setAttribute("tabindex", "-1"); $("#offers-title").focus({ preventScroll: true });
  });
});
$("#start-over").addEventListener("click", () => {
  if (mutationPending || chatPending) { showToast("Please wait for the current request to finish."); return; }
  application = null; selectedOfferId = undefined; generation++;
  $("#dashboard").hidden = true; $("#floating-chat").hidden = true; $("#welcome").hidden = false;
  $<HTMLInputElement>("#demo-consent").checked = false;
  $("#income-result").replaceChildren(); $("#chat-messages").replaceChildren();
  $("#pan").focus(); window.scrollTo({ top: 0, behavior: "smooth" });
});

function renderCredit() {
  if (!application) return;
  const report = application.creditReport;
  $("#score-gauge").dataset.health = report.score >= 750 ? "good" : report.score >= 660 ? "fair" : "attention";
  $("#score-gauge").dataset.change = report.scoreChange >= 0 ? "positive" : "negative";
  const fraction = Math.max(0, Math.min(1, (report.score - 300) / 600));
  const angle = Math.PI * (1 - fraction), x = 130 + 107 * Math.cos(angle), y = 125 - 107 * Math.sin(angle);
  $("#score-gauge").innerHTML = `<div class="score-gauge"><svg viewBox="0 0 260 145" role="img" aria-label="Credit score ${report.score} out of 900"><defs><linearGradient id="score-gradient"><stop offset="0%" stop-color="#eaa17c"/><stop offset="36%" stop-color="#e5ce80"/><stop offset="70%" stop-color="#87c9a4"/><stop offset="100%" stop-color="#23ad88"/></linearGradient></defs><path d="M23 125 A107 107 0 0 1 237 125" fill="none" stroke="#edf2f5" stroke-width="12" stroke-linecap="round"/><path d="M23 125 A107 107 0 0 1 237 125" fill="none" stroke="url(#score-gradient)" stroke-width="12" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="7" fill="#002970" stroke="white" stroke-width="3"/></svg><div class="gauge-center"><strong>${report.score}</strong><span>${escape(title(report.scoreLabel))}</span></div><div class="gauge-scale"><span>300</span><span>900</span></div></div><p class="score-change"><span>${report.scoreChange >= 0 ? "↗" : "↘"} ${Math.abs(report.scoreChange)} points</span> · As of ${date(report.asOf)}</p>`;
  const summary = report.summary;
  const rows = [
    { key: "loans", icon: "▥", label: "Loan accounts", value: money(summary.loanAccounts.outstanding), rating: summary.loanAccounts.rating },
    { key: "cards", icon: "▤", label: "Credit utilization", value: `${summary.creditCard.utilizationPercent}%`, rating: summary.creditCard.rating },
    { key: "overdues", icon: "✓", label: "Total overdues", value: summary.totalOverdues.amount ? money(summary.totalOverdues.amount) : "No dues", rating: summary.totalOverdues.rating },
    { key: "age", icon: "◷", label: "Age of accounts", value: `${Math.floor(summary.ageOfAccounts.oldestMonths / 12)} years+`, rating: summary.ageOfAccounts.rating },
    { key: "enquiries", icon: "⌕", label: "Recent enquiries", value: String(summary.recentEnquiries.count), rating: summary.recentEnquiries.rating },
  ];
  $("#credit-factors").innerHTML = rows.map(row => `<button class="factor-row" type="button" data-report="${row.key}" aria-label="View ${row.label} details"><span class="factor-icon" aria-hidden="true">${row.icon}</span><span class="factor-copy"><strong>${row.label}</strong><small>${row.value}</small></span><span class="rating ${row.rating}">${escape(title(row.rating))}</span><b aria-hidden="true">›</b></button>`).join("");
}
function renderAssessment() {
  if (!application) return;
  const assessment = application.assessment;
  const capacity = assessment.affordability;
  const budget = assessment.monthlyBudget ?? Math.max(1, capacity.policyMonthlyLimit);
  $<HTMLInputElement>("#monthly-budget").value = String(budget);
  const range = $<HTMLInputElement>("#budget-range");
  range.max = String(Math.max(5000, Math.ceil(Math.max(capacity.policyMonthlyLimit, budget) / 5000) * 5000));
  range.value = String(budget); $("#range-max").textContent = money(Number(range.max));
  $("#capacity-note").textContent = `New-EMI capacity: ${money(capacity.policyMonthlyLimit)}/month · Requested: ${money(assessment.requestedAmount)}`;
  $("#transaction-points").textContent = `${assessment.transactionFactor.points} / 5 supporting points`;
  const factor = assessment.transactionFactor;
  $("#transaction-summary").innerHTML = `<div><span>Sent in this period</span><strong>${money(factor.sentAmount)}</strong></div><div><span>Received in this period</span><strong>${money(factor.receivedAmount)}</strong></div><div><span>Months with eligible inflows</span><strong>${factor.activeMonths} <small>/ 3</small></strong></div>`;
  $("#income-state").textContent = assessment.incomeStatus === "matched_synthetic_credits"
    ? "✓ Salary figures match the bank credits for all three months."
    : assessment.incomeStatus === "needs_review" ? "Income check needs review. Offers are paused until discrepancies are resolved."
    : "Income is based on the supplied bank credits. You can cross-check salary fields when needed.";
  renderOffers();
}
function renderOffers() {
  if (!application) return;
  const assessment = application.assessment;
  document.querySelectorAll<HTMLButtonElement>("[data-tenure]").forEach(button => {
    const selected = Number(button.dataset.tenure) === selectedTenure;
    button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
  });
  let offers = assessment.offers.filter(offer => offer.tenureMonths === selectedTenure);
  const availableCount = offers.filter(offer => offer.available).length;
  if ($<HTMLInputElement>("#available-only").checked) offers = offers.filter(offer => offer.available);
  offers.sort((a, b) => Number(b.available) - Number(a.available) || b.amount - a.amount || a.totalInterest - b.totalInterest);
  $("#offer-count").textContent = `${availableCount} available · ${selectedTenure} months`;
  $("#offer-state").textContent = assessment.status === "needs_income_review"
    ? "Let’s clarify your income details first. Resolve the cross-check issues below to refresh your offers."
    : !availableCount ? "No offers fit this profile and budget at this tenure. Your guide can explain the factors and next steps."
    : "";
  $("#offer-list").innerHTML = offers.length ? offers.map((offer, index) => offerCard(offer, index === 0 && offer.available)).join("")
    : '<div class="empty-state">No available offers at this tenure.<br>Try another tenure or turn off “Available only” to see the reasons.</div>';
}
function offerCard(offer: LoanOffer, best: boolean) {
  const letter = offer.lender.split(" ").slice(0, 2).map(word => word[0]).join("");
  const lenderStyle = offer.id.includes("partner-a") ? "a" : offer.id.includes("partner-b") ? "b" : "c";
  const blockers = offer.reasons.filter(reason => reason.kind === "limitation");
  return `<article class="loan-card ${best ? "best" : ""} ${offer.available ? "" : "unavailable"}" aria-label="${escape(offer.lender)} offer">
    ${best ? '<span class="recommended-tag">HIGHEST AMOUNT AT THIS TENURE</span>' : ""}
    <div class="loan-top"><span class="lender-symbol ${lenderStyle}">${letter}</span><div><h3>${escape(offer.lender)}</h3><p>Personal loan</p></div><span class="chance ${offer.chance}" title="${escape(offer.chanceMeaning)}">${title(offer.chance)} chance</span></div>
    <dl class="loan-numbers"><div><dt>Loan amount</dt><dd>${money(offer.amount)}</dd></div><div><dt>Monthly EMI</dt><dd>${preciseCurrency.format(offer.monthlyEmi)}</dd></div><div><dt>Interest rate</dt><dd>${offer.annualInterestRate}% <small>p.a.</small></dd></div></dl>
    ${!offer.available ? `<p class="unavailable-copy">No offer available. ${escape(blockers[0]?.explanation ?? "See the assessment for details.")}</p>` : ""}
    <div class="loan-bottom"><div class="repayment-line">${offer.available ? `Total repayment <strong>${money(offer.totalRepayment)}</strong><br>Interest ${money(offer.totalInterest)} · ${offer.tenureMonths} months · No processing fee` : "A chance label is not an approval decision."}</div><button type="button" class="text-button" data-explain="${escape(offer.id)}">${offer.available ? "Understand this offer" : "Why no offer?"} <span>↗</span></button></div></article>`;
}
$(".segmented").addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-tenure]");
  if (button) { selectedTenure = Number(button.dataset.tenure); renderOffers(); }
});
$("#available-only").addEventListener("change", renderOffers);
$("#budget-range").addEventListener("input", () => { $<HTMLInputElement>("#monthly-budget").value = $<HTMLInputElement>("#budget-range").value; });
$("#monthly-budget").addEventListener("input", () => {
  const input = $<HTMLInputElement>("#monthly-budget"), range = $<HTMLInputElement>("#budget-range");
  range.value = String(Math.min(Number(range.max), Number(input.value)));
});
$("#budget-form").addEventListener("submit", event => {
  event.preventDefault(); const current = application; if (!current) return;
  const budget = Number($<HTMLInputElement>("#monthly-budget").value);
  void mutation(event.currentTarget as HTMLFormElement, $("#budget-error"), async () => {
    const result = await api<Assessment>(`/applications/${current.id}/budget`, { monthlyBudget: budget });
    setAssessment(result); showToast("Offers updated to match your monthly budget.");
  });
});
$("#reset-budget").addEventListener("click", () => {
  if (!application) return; const id = application.id;
  void mutation($<HTMLFormElement>("#budget-form"), $("#budget-error"), async () => {
    setAssessment(await api<Assessment>(`/applications/${id}/budget`, { monthlyBudget: null })); showToast("Using your assessed repayment capacity.");
  });
});

function accountMarkup(report: CreditReport, filter = "all") {
  const accounts = report.accounts.filter(account => filter === "cards" ? account.type === "credit_card" : filter === "loans" ? account.type === "personal_loan" : true);
  return accounts.map(account => `<details class="report-account" ${filter !== "all" ? "open" : ""}>
    <summary>${escape(account.lender)} · ${escape(account.accountLabel)} <span class="micro-tag">${title(account.status)}</span></summary>
    <div class="account-body"><dl class="account-meta">
      <div><dt>Account type</dt><dd>${title(account.type)}</dd></div><div><dt>Outstanding</dt><dd>${money(account.outstanding)}</dd></div>
      <div><dt>${account.type === "credit_card" ? "Minimum monthly payment" : "Monthly EMI"}</dt><dd>${money(account.type === "credit_card" ? account.minimumMonthlyPayment : account.monthlyEmi)}</dd></div>
      <div><dt>Current overdue</dt><dd>${money(account.overdue)}</dd></div><div><dt>Opened</dt><dd>${date(account.openedOn)}</dd></div>
      <div><dt>${account.type === "credit_card" ? "Credit limit" : "Original loan amount"}</dt><dd>${money(account.type === "credit_card" ? account.creditLimit : account.sanctionedAmount)}</dd></div>
      <div><dt>Last reported</dt><dd>${date(account.reportedOn)}</dd></div>
    </dl><p class="small muted">${account.closedOn ? `Closed ${date(account.closedOn)} · ` : ""}Repayment history</p>
    <div class="table-wrap"><table><thead><tr><th>Month</th><th>Due</th><th>Amount due</th><th>Paid</th><th>Payment date</th><th>Payment delay (days)</th><th>Month-end overdue</th><th>Month-end DPD</th></tr></thead>
    <tbody>${account.payments.map(payment => `<tr><td>${month(payment.month)}</td><td>${date(payment.dueDate)}</td><td>${money(payment.amountDue)}</td><td>${money(payment.amountPaid)}</td><td>${payment.paidOn ? date(payment.paidOn) : "No payment due"}</td><td>${payment.paymentDelayDays}</td><td class="${payment.overdueAtMonthEnd ? "debit" : "credit"}">${money(payment.overdueAtMonthEnd)}</td><td>${payment.daysPastDue}</td></tr>`).join("")}</tbody></table></div></div></details>`).join("");
}
function showDetails(heading: string, markup: string) {
  $("#detail-title").textContent = heading; $("#detail-body").innerHTML = markup;
  const dialog = $<HTMLDialogElement>("#detail-dialog"); if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0;
}
function openReport(section = "all") {
  if (!application) return; const report = application.creditReport;
  const enquiries = `<section class="detail-section"><h3>Recent credit enquiries</h3>${report.enquiries.length
    ? `<div class="table-wrap"><table><thead><tr><th>Lender</th><th>Date</th><th>Purpose</th><th>Requested amount</th><th>Type</th></tr></thead><tbody>${report.enquiries.map(enquiry => `<tr><td>${escape(enquiry.lender)}</td><td>${date(enquiry.date)}</td><td>${title(enquiry.purpose)}</td><td>${money(enquiry.requestedAmount)}</td><td>Hard enquiry</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="insight-line">No recent enquiries are recorded.</p>'}<p class="small muted">Enquiries need context; they are not automatically mistakes.</p></section>`;
  const note = section === "overdues" ? `Reported overdues: ${money(report.summary.totalOverdues.amount)}. Review account-level entries below.`
    : section === "age" ? `The oldest account is ${report.summary.ageOfAccounts.oldestMonths} months old. Account age alone is not a confirmed reason for a smaller offer.`
    : section === "cards" ? `Card utilization is ${report.summary.creditCard.utilizationPercent}%. Outstanding ${money(report.summary.creditCard.outstanding)} against a ${money(report.summary.creditCard.limit)} limit.`
    : `Score ${report.score} · As of ${date(report.asOf)}.`;
  showDetails(section === "enquiries" ? "Your credit enquiries" : "Your credit report",
    `<p class="detail-intro">${escape(note)}</p>${section === "enquiries" ? enquiries : `<section class="detail-section"><h3>Account details &amp; repayment history</h3>${accountMarkup(report, section)}</section>${enquiries}`}<p class="small muted">Account balances reflect each lender’s reporting date. Enquiries are applications, not outstanding loans.</p>`);
}
$("#report-button").addEventListener("click", () => openReport());
$("#credit-factors").addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-report]"); if (button) openReport(button.dataset.report);
});
$("#close-details").addEventListener("click", () => $<HTMLDialogElement>("#detail-dialog").close());
function transactionTable(transactions: Transaction[]) {
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Counterparty</th><th>Category</th><th>Amount</th></tr></thead><tbody>${transactions.map(transaction => `<tr><td>${date(transaction.date)}</td><td>${escape(transaction.counterparty)}</td><td>${title(transaction.category)}</td><td class="${transaction.direction === "credit" ? "credit" : "debit"}">${transaction.direction === "credit" ? "+" : "−"}${money(transaction.amount)}</td></tr>`).join("")}</tbody></table></div>`;
}
$("#transactions-button").addEventListener("click", () => {
  if (!application) return;
  showDetails("The story behind the activity", `<p class="detail-intro">${escape(application.assessment.transactionFactor.explanation)}</p><section class="detail-section"><h3>Paytm transactions</h3>${transactionTable(application.paytmHistory.transactions)}</section><section class="detail-section"><h3>Bank transactions</h3>${transactionTable(application.aaData.transactions)}</section><p class="insight-line">Recurring eligible inflows are supporting cash-flow context. Self-transfers, refunds and higher spending do not earn eligibility points. Paytm receipts are not added again to bank income.</p>`);
});

$("#income-button").addEventListener("click", () => {
  if (!application) return;
  $<HTMLInputElement>("#employee-name").value = application.aaData.accountHolder;
  $<HTMLInputElement>("#employer-name").value = application.aaData.employer;
  $("#salary-months").innerHTML = ["2026-08", "2026-09", "2026-10"].map(value => `<div class="month-fields"><label for="salary-${value}">${month(value)}</label><div class="rupee-field"><span>₹</span><input id="salary-${value}" data-month="${value}" type="number" min="0.01" max="10000000" step="0.01" required placeholder="Net salary on slip"></div></div>`).join("");
  $("#income-error").textContent = "";
  $("#income-result").replaceChildren(); $<HTMLDialogElement>("#income-dialog").showModal();
});
$("#fill-salary").addEventListener("click", () => {
  if (!application) return;
  document.querySelectorAll<HTMLInputElement>("[data-month]").forEach(input => {
    input.value = String(application!.aaData.transactions.filter(transaction => transaction.category === "salary"
      && transaction.direction === "credit" && transaction.date.startsWith(input.dataset.month!)).reduce((sum, transaction) => sum + transaction.amount, 0));
  });
});
$("#income-form").addEventListener("submit", event => {
  event.preventDefault(); if (!application) return;
  const id = application.id;
  const employeeName = $<HTMLInputElement>("#employee-name").value, employer = $<HTMLInputElement>("#employer-name").value;
  const salarySlips = [...document.querySelectorAll<HTMLInputElement>("[data-month]")].map(input => ({ employeeName, employer, month: input.dataset.month!, netSalary: Number(input.value) }));
  void mutation(event.currentTarget as HTMLFormElement, $("#income-error"), async () => {
    const result = await api<{ incomeCheck: IncomeCheck; assessment: Assessment }>(`/applications/${id}/income-check`, { salarySlips });
    setAssessment(result.assessment);
    const check = result.incomeCheck;
    $("#income-result").innerHTML = `<div class="income-result ${check.status === "needs_review" ? "review" : ""}"><strong>${check.status === "needs_review" ? "A few details need clarification." : "The salary figures match the bank credits."}</strong>${check.issues.length ? `<ul>${check.issues.map(issue => `<li>${issue.month ? `${month(issue.month)}: ` : ""}${escape(issue.message)}</li>`).join("")}</ul>` : '<p>Three months matched. Your offers have been refreshed.</p>'}<p>This confirms matching figures, not document authenticity.</p></div>`;
  });
});
$("#close-income").addEventListener("click", () => $<HTMLDialogElement>("#income-dialog").close());

function addMessage(role: "user" | "assistant", text: string, source?: string) {
  const message = document.createElement("div"); message.className = `chat-message ${role}`;
  const paragraph = document.createElement("p"); paragraph.textContent = text; message.append(paragraph);
  if (source) { const label = document.createElement("small"); label.textContent = source; message.append(label); }
  $("#chat-messages").append(message); message.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return message;
}
function renderChatContext() {
  if (!application) return;
  const selected = application.assessment.offers.find(offer => offer.id === selectedOfferId);
  $("#chat-context").textContent = selected ? `${selected.lender} · ${selected.tenureMonths} months · ${selected.available ? `${money(selected.amount)} / ${preciseCurrency.format(selected.monthlyEmi)} EMI` : "No offer available"}`
    : `Your credit profile · Score ${application.creditReport.score} · ${title(application.customer.scenario)}`;
}
function openChat(offerId?: string) {
  if (!application) return;
  if (chatPending && offerId !== selectedOfferId) { showToast("Please wait for your guide’s reply before switching offers."); return; }
  selectedOfferId = offerId; renderChatContext();
  const dialog = $<HTMLDialogElement>("#chat-dialog"); if (!dialog.open) dialog.showModal();
  if (!$("#chat-messages").children.length) addMessage("assistant", "Hi, I’m your lending guide. I can explain what’s going well, why an offer is smaller or unavailable, and what to consider next. What would you like to understand?", "Based on your report");
  $("#chat-input").focus();
}
$("#floating-chat").addEventListener("click", () => openChat(selectedOfferId));
$("#profile-explain").addEventListener("click", () => openChat());
$("#close-chat").addEventListener("click", () => $<HTMLDialogElement>("#chat-dialog").close());
$("#offer-list").addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-explain]");
  if (!button || chatPending) return;
  openChat(button.dataset.explain);
  void askQuestion("Explain the chance label and the main reasons for this specific offer. What can I consider next?");
});
async function askQuestion(question: string) {
  const current = application, requestGeneration = generation;
  if (!current || chatPending) return;
  chatPending = true; $("#chat-error").textContent = "";
  const controls = [...$("#chat-form").querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement>("button,textarea,input"), ...$("#quick-questions").querySelectorAll<HTMLButtonElement>("button")];
  const wasAiDisabled = $<HTMLInputElement>("#use-ai").disabled;
  const useAi = $<HTMLInputElement>("#use-ai").checked;
  controls.forEach(control => { control.disabled = true; });
  addMessage("user", question);
  const pending = addMessage("assistant", "Checking your report and offer details…"); pending.classList.add("pending");
  try {
    const result = await api<Explanation>(`/applications/${current.id}/chat`, { question, useAi, ...(selectedOfferId ? { offerId: selectedOfferId } : {}) });
    if (generation !== requestGeneration) return;
    pending.remove();
    addMessage("assistant", result.answer,
      result.source === "sarvam" ? "Sarvam AI" : result.source === "local_fallback" ? "Sarvam unavailable · Report-based fallback" : "Based on your report");
  } catch (error) { pending.remove(); $("#chat-error").textContent = errorText(error); }
  finally { controls.forEach(control => { control.disabled = false; }); $<HTMLInputElement>("#use-ai").disabled = wasAiDisabled; chatPending = false; }
}
$("#chat-form").addEventListener("submit", event => {
  event.preventDefault(); const input = $<HTMLTextAreaElement>("#chat-input");
  const question = input.value.trim(); if (!question || chatPending) return; input.value = ""; void askQuestion(question);
});
$("#chat-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $<HTMLFormElement>("#chat-form").requestSubmit(); }
});
$("#quick-questions").addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-question]"); if (button?.dataset.question) void askQuestion(button.dataset.question);
});
void api<{ aiAvailable: boolean }>("/health").then(health => {
  const toggle = $<HTMLInputElement>("#use-ai"); toggle.checked = health.aiAvailable; toggle.disabled = !health.aiAvailable;
  $("#chat-mode").textContent = health.aiAvailable ? "Powered by Sarvam · Answers from your report" : "Answers from your report";
}).catch(() => { $<HTMLInputElement>("#use-ai").checked = false; $("#application-error").textContent = "The lending service is unavailable. Check that its backend is running."; });
