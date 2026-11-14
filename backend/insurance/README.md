# Insurance backend

Run from the repository root with Node 24 and installed npm dependencies.

```sh
node backend/insurance/server.js
# To enable Sarvam extraction using the local environment file
node --env-file=.env backend/insurance/server.js
```

The API binds to localhost on port 3001 by default. Signed-in accounts, the latest renewal context, saved preferences and chat history are stored in local SQLite (`.insurance.sqlite`, configurable with `INSURANCE_DB`). Guest data and quote results are in memory. The demo supplies only the two sample one-year comprehensive quotes. It stops at quote selection. The returned customer token is a demo bearer credential and must be kept private. A production deployment needs public-facing account recovery, email verification, HTTPS and insurer integrations.

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

Use the page's **Sign in** button to create an account or return to your latest renewal. **Insurance chat** uses that account's confirmed car, policy, preferences and current quotes. It answers supported questions directly from those fields and keeps up to 40 messages per account. Customers can clear chat history. The chat answers locally and does not require a Sarvam key.

Account endpoints are `POST /insurance/signup`, `POST /insurance/signin`, `POST /insurance/signout`, and `GET /insurance/account`. Signup and sign-in accept email and password and establish an HTTP-only cookie. Signed-in renewal routes use the cookie. `GET /insurance/chat` reads history, `POST /insurance/chat` accepts `{"message":"What preferences are you using?"}`, and `DELETE /insurance/chat` clears history.
