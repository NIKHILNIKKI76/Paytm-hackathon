# Insurance backend

Run from the repository root with Node 24 and installed npm dependencies.

```sh
npm install
npm start
# Run the integration and ranking checks
npm test
```

Open http://127.0.0.1:3001 for the frontend and API together. `npm start` loads `.env` if it exists; configure `SARVAM_API_KEY` there to enable AI features. Keep that file private. Lending is available at `/lending/` on the same port. Set `PORT` to change the shared port. Startup fails if that port is occupied. The lending browser script is built automatically.

The API binds to localhost on port 3001 by default. Signed-in accounts, the latest renewal context, saved preferences and chat history are stored in local SQLite (`.insurance.sqlite`, configurable with `INSURANCE_DB`). Guest data and quote results are in memory. The demo supplies five fictional one-year comprehensive quotes. It stops at quote selection. The returned customer token is a demo bearer credential and must be kept private. A production deployment needs public-facing account recovery, email verification, HTTPS and insurer integrations.

## API

Start with `POST /insurance/journeys` and a JSON object such as `{"vehicle":{"registration":"DL01AB1234"}}`. The response includes the journey ID and customer token. Send `Authorization: Bearer <customerToken>` on all journey routes. Supply the same `customerToken` in a new journey's creation body to load preferences saved for the same vehicle during this server run.

Routes below are relative to `/insurance/journeys/<id>`.

| Method and path | Request and result |
| --- | --- |
| GET / | Current context and active inline prompts |
| PATCH / | Confirm or correct fields in `vehicle`, `policy` or `preferences`. A null field clears its value. |
| POST /events | Record `{"type":"sort_by_price"}` or `{"type":"skip_prompt","promptId":"keep_zero_depreciation"}` |
| POST /policy-extraction | Raw PDF, PNG or JPEG body with its content type and `X-Document-Consent: true`. Returns editable suggestions for a subsequent PATCH. |
| POST /preference-extraction | JSON `{"text":"Keep zero depreciation"}`. Returns editable suggestions for a subsequent PATCH. |
| GET /quotes | Ranked or neutral comparison, missing terms, differences versus the comparison baseline and current policy |
| POST /selection | `{"quoteId":"quote-a"}` selects an eligible matching quote from a current comparison |
| PUT /saved-preferences | Replace saved preferences for this car with confirmed keys, e.g. `{"keys":["requiredAddOns"]}` |
| DELETE /saved-preferences | Clear saved preferences for this car |

For the sample walkthrough, PATCH `{"preferences":{"budget":10000,"budgetMode":"hard","requiredAddOns":["zero_depreciation"],"priority":"repair_cost"}}`, then GET the quotes. Set `requiredAddOns` to an empty array and `priority` to `price` to see Quote B. Field names and supported values are defined in [inputs.js](inputs.js).

Extraction requires `SARVAM_API_KEY` and sends extracted text to Sarvam. PDF extraction uses Poppler's `pdftotext` for text-based PDFs. PNG and JPEG extraction uses Tesseract. For scanned PDFs, upload a page image or enter details manually. Files and extracted text are processed in memory. Quote explanations use deterministic amounts and reasons derived from the quote fields.


## Accounts and chat

Use the page's **Sign in** button to create an account or return to your latest renewal. **Insurance chat** uses that account's confirmed policy, preferences and current sample comparison. It keeps up to 40 messages per account. Customers can clear chat history. By default, chat answers locally without an API key. Opt into the **Use Sarvam AI** checkbox to send the message, recent conversation and confirmed context to `sarvam-105b` for explanation. AI cannot update preferences, determine quote eligibility, or select a quote. Failures are reported without exposing credentials; manual comparison remains available.

`GET /insurance/status` reports whether the provider is configured (not a live connectivity check). `POST /insurance/chat` accepts `X-AI-Consent: true` to use Sarvam and returns `provider: "sarvam"`; without consent it returns `provider: "local"`. Document extraction has its separate required consent header. All API keys remain on the server.

Current scope follows the latest root `insurance.md`: private-car renewal using five synthetic comprehensive quotes, ending at selection. Health insurance and claims are outside this implementation. Quote dates, requested cover, term, NCB, garage availability, and unknown add-on terms are displayed for review. Sample quotes do not constitute live insurer prices or verified coverage.

Account endpoints are `POST /insurance/signup`, `POST /insurance/signin`, `POST /insurance/signout`, and `GET /insurance/account`. Signup and sign-in accept email and password and establish an HTTP-only cookie. Signed-in renewal routes use the cookie. `GET /insurance/chat` reads history, `POST /insurance/chat` accepts `{"message":"What preferences are you using?"}`, and `DELETE /insurance/chat` clears history.

See [SYNTHETIC_DATA.md](SYNTHETIC_DATA.md) for the provider fixture and ranking examples.

**Try sample renewal** now prefills the sample context and opens comparison immediately. Preference changes apply automatically in sample mode. Guest journeys can use their bearer-protected `/insurance/journeys/<id>/chat` endpoint without signing in; Sarvam still requires explicit AI consent. Signed-in users retain their account chat and latest confirmed context. See the root [DEMO.md](../../DEMO.md) for the tested presentation sequence.
