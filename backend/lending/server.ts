import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { buildProfile, DEMO_AS_OF, selectScenario } from "./demo-data.ts";
import { assessEligibility } from "./eligibility.ts";
import { crossCheckIncome, parseSalarySlips } from "./income.ts";
import { createSarvamRewrite, explainAssessment } from "./bot.ts";
import type { ChatTurn, Rewrite } from "./bot.ts";
import { DEMO_NOTICE } from "./types.ts";
import type { IncomeCheck, Profile, Scenario } from "./types.ts";
import { amount, identity, InputError, object, textField } from "./validation.ts";

interface Application {
  id: string; expiresAt: number; maskedPan: string; maskedPhone: string;
  profile: Profile; requestedAmount: number; monthlyBudget: number | null; incomeCheck?: IncomeCheck;
  chatHistory: ChatTurn[]; chatPending: boolean;
}
interface ServerOptions { apiKey?: string; rewrite?: Rewrite; now?: () => number }
async function readJson(request: IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new InputError("Use Content-Type: application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 32768) {
      const error = new InputError("Request body exceeds 32 KiB."); error.status = 413; throw error;
    }
    chunks.push(Buffer.from(chunk));
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) { if (error instanceof InputError) throw error; throw new InputError("Invalid JSON body."); }
}
function send(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(payload));
}
export function createLendingServer(options: ServerOptions = {}) {
  const applications = new Map<string, Application>();
  const now = options.now ?? Date.now;
  const rewrite = options.rewrite ?? (options.apiKey?.trim() ? createSarvamRewrite(options.apiKey) : undefined);
  const snapshot = (application: Application) => ({
    synthetic: true, notice: DEMO_NOTICE, id: application.id,
    expiresAt: new Date(application.expiresAt).toISOString(),
    customer: { maskedPan: application.maskedPan, maskedPhone: application.maskedPhone,
      name: application.profile.customerName, scenario: application.profile.scenario },
    creditReport: application.profile.report,
    paytmHistory: { synthetic: true, transactions: application.profile.paytmTransactions },
    aaData: { synthetic: true, asOf: DEMO_AS_OF, accountHolder: application.profile.customerName,
      employer: application.profile.employer, transactions: application.profile.aaTransactions },
    assessment: assessEligibility(application.profile, application.requestedAmount, application.monthlyBudget, application.incomeCheck),
  });
  return createServer(async (request, response) => {
    try {
      for (const [id, application] of applications) if (application.expiresAt <= now()) applications.delete(id);
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && pathname === "/") {
        response.writeHead(302, { Location: "/lending/" }).end(); return;
      }
      const pages = new Map([
        ["/lending", ["index.html", "text/html; charset=utf-8"]],
        ["/lending/", ["index.html", "text/html; charset=utf-8"]],
        ["/lending/styles.css", ["styles.css", "text/css; charset=utf-8"]],
        ["/lending/app.js", ["dist/app.js", "text/javascript; charset=utf-8"]],
      ]);
      const page = pages.get(pathname);
      if (request.method === "GET" && page) {
        try {
          const content = await readFile(new URL(`../../frontend/lending/${page[0]}`, import.meta.url));
          response.writeHead(200, { "Content-Type": page[1]!, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(content);
        } catch { send(response, 503, { error: "Lending page is unavailable. Run npm run build:frontend in backend/lending." }); }
        return;
      }
      if (request.method === "GET" && pathname === "/health") {
        send(response, 200, { status: "ok", synthetic: true, notice: DEMO_NOTICE, aiAvailable: Boolean(rewrite) }); return;
      }
      if (request.method === "POST" && pathname === "/applications") {
        const input = await readJson(request);
        if (input.demoConsent !== true) throw new InputError("Set demoConsent: true to acknowledge synthetic data; this is not real bureau/AA consent.");
        const { pan, phone } = identity(input);
        const requestedAmount = input.requestedAmount === undefined ? 200000 : amount(input.requestedAmount, "requestedAmount");
        const monthlyBudget = input.monthlyBudget === undefined || input.monthlyBudget === null
          ? null : amount(input.monthlyBudget, "monthlyBudget", 1000000);
        if (input.scenario !== undefined && !["strong", "moderate", "stressed"].includes(String(input.scenario)))
          throw new InputError("scenario must be strong, moderate or stressed.");
        if (applications.size >= 100) { send(response, 503, { error: "Demo session capacity reached; try after sessions expire." }); return; }
        const application: Application = { id: randomUUID(), expiresAt: now() + 60 * 60 * 1000,
          maskedPan: `${pan.slice(0, 2)}******${pan.slice(-2)}`, maskedPhone: `******${phone.slice(-4)}`,
          profile: buildProfile(input.scenario as Scenario | undefined ?? selectScenario(pan, phone)),
          requestedAmount, monthlyBudget, chatHistory: [], chatPending: false };
        applications.set(application.id, application);
        send(response, 201, snapshot(application)); return;
      }
      const match = /^\/applications\/([a-f0-9-]{36})(?:\/(credit-report|offers|transactions|budget|income-check|chat))?$/.exec(pathname);
      if (!match) { send(response, 404, { error: "Route not found." }); return; }
      const application = applications.get(match[1]!);
      if (!application) { send(response, 404, { error: "Application not found or expired." }); return; }
      const resource = match[2];
      if (request.method === "GET" && (!resource || ["credit-report", "offers", "transactions"].includes(resource))) {
        const result = snapshot(application);
        send(response, 200, !resource ? result : resource === "credit-report" ? { synthetic: true, notice: DEMO_NOTICE, creditReport: result.creditReport }
          : resource === "offers" ? result.assessment : { synthetic: true, notice: DEMO_NOTICE, paytmHistory: result.paytmHistory,
            aaData: result.aaData, transactionFactor: result.assessment.transactionFactor }); return;
      }
      if (request.method === "POST" && resource === "budget") {
        const input = await readJson(request);
        const monthlyBudget = input.monthlyBudget === null ? null : amount(input.monthlyBudget, "monthlyBudget", 1000000);
        const requestedAmount = input.requestedAmount === undefined ? application.requestedAmount : amount(input.requestedAmount, "requestedAmount");
        application.monthlyBudget = monthlyBudget; application.requestedAmount = requestedAmount;
        send(response, 200, snapshot(application).assessment); return;
      }
      if (request.method === "POST" && resource === "income-check") {
        const input = await readJson(request);
        const slips = parseSalarySlips(input.salarySlips);
        application.incomeCheck = crossCheckIncome(application.profile, slips);
        send(response, 200, { synthetic: true, notice: DEMO_NOTICE, incomeCheck: application.incomeCheck,
          assessment: snapshot(application).assessment }); return;
      }
      if (request.method === "POST" && resource === "chat") {
        const input = await readJson(request);
        const question = textField(input.question, "question", 2000);
        const offerId = input.offerId === undefined ? undefined : textField(input.offerId, "offerId", 80);
        if (input.useAi !== undefined && typeof input.useAi !== "boolean") throw new InputError("useAi must be boolean.");
        if (input.useAi === true && !rewrite) { send(response, 503, { error: "SARVAM_API_KEY is required for AI explanations. No AI request made." }); return; }
        if (application.chatPending) { send(response, 409, { error: "Please wait for the current reply." }); return; }
        application.chatPending = true;
        try {
          const explanation = await explainAssessment(snapshot(application).assessment, question, offerId, input.useAi === true ? rewrite : undefined, application.chatHistory);
          application.chatHistory.push({ role: "user", content: question }, { role: "assistant", content: explanation.answer });
          application.chatHistory = application.chatHistory.slice(-12);
          send(response, 200, explanation); return;
        } finally { application.chatPending = false; }
      }
      send(response, 405, { error: "Method not allowed for this resource." });
    } catch (error) {
      send(response, error instanceof InputError ? error.status : 500,
        { error: error instanceof InputError ? error.message : "Unable to process the demo request." });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.LENDING_PORT ?? process.env.PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  const server = createLendingServer({ apiKey: process.env.SARVAM_API_KEY });
  server.on("error", () => { console.error("Unable to start lending demo server; check whether the port is in use."); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Lending demo: http://127.0.0.1:${port} (synthetic data only)`));
}
