# Lending frontend

Responsive HTML/CSS and strict TypeScript, served by the lending backend. No
frontend framework or additional application dependency is needed. Browser output
`dist/app.js` is generated and ignored; never hand-edit it.

From `backend/lending`, activate Node 24.22.3 and npm 11.21.2, then:

```powershell
npm.cmd run typecheck:frontend
npm.cmd start
```

Open **http://127.0.0.1:3002/lending/**. Start builds the frontend and reads the
repository-root `.env` for Sarvam. The key is never exposed to the browser.
Type checking uses the existing pinned TypeScript 7.0.2 installation.

1. Click **Use sample PAN & phone**, choose a demo profile, acknowledge the
   synthetic-data notice, and submit.
2. Expand credit factors or **Explore full report** to see accounts, history and enquiries.
3. Set a monthly EMI budget, update offers, and compare 12/24/36-month tenures.
4. Click **Understand this offer** or **Why no offer?** for its explanation.
5. Review transaction details or cross-check three months of salary fields.

The chat detects whether Sarvam is configured. With it enabled, questions use the
existing bot endpoint. Without a key, the guide uses local decision facts. Provider
errors are labelled and the backend supplies a local fallback. Profile data and
chat messages are not persisted by the browser; sessions expire on the server.

The sample profiles, scores, transactions, offers and decision rules are simulated.
Offer cards use Hero FinCorp, Tata Capital and Aditya Birla Capital as illustrative
lender names. A single page notice explains that these are not offers issued by
the named companies. Chat replies use short, report-specific explanations, with
the same fact-checked answer available if AI fails the wording checks.
The salary feature compares structured fields; it does not upload PDFs/images.
No credit enquiry, real application or loan acceptance is performed.

Run `npm start` from the repository root to serve both frontends and APIs on port 3001.
Insurance is at `/` and Lending at `/lending/`. Set `PORT` to change the shared port.
