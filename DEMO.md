# Car insurance sample demo

## Start

The verified demo instance is http://127.0.0.1:3001.

To restart the same instance and retain its local demo account:

```sh
PORT=3001 INSURANCE_DB=.insurance.sqlite.demo npm start
```

The server loads the Sarvam key from the ignored local `.env`. Account details stay in ignored local SQLite files. Use the demo credentials supplied in chat; this is a local demo account, not a real customer identity.

## Presentation sequence

1. Open the URL, choose **Sign in**, and sign in with the demo account.
2. If an existing renewal opens on **Current cover**, click **Back** to reach **Your car**.
3. Click **Try sample renewal**. The fictional car, current policy, dates, claim-history answer and preferences are filled automatically. The comparison opens immediately with five providers. Sample Insurer A leads at ₹9,400 under the ₹10,000 hard budget with zero depreciation required.
4. Click **Insurance chat**, enable **Use Sarvam AI**, and ask: “What is my current budget and why does this provider match?” Wait for “Reply from Sarvam AI.” Close chat.
5. Click **Lowest premium**: Sample Insurer B leads at ₹8,500.
6. Click **Zero depreciation under ₹10,000**: Sample Insurer A leads again.
7. Expand **Preferences used**, change budget to `9000`, then click outside the field. In sample mode the change applies automatically; no quote meets the requirements.
8. Open chat and ask: “What is my current budget and does any provider meet all requirements?” Sarvam should use ₹9,000, not the earlier ₹10,000. Close chat.
9. Set zero depreciation to **Optional**: Sample Insurer B qualifies and leads automatically.
10. Change **Requested cover** to **Third-party**: comprehensive quotes disappear, with a message that only one-year comprehensive quotes exist in this demo.
11. Click **Lower deductible under ₹14,000**: comprehensive cover is restored and Demo Cedar Insurance leads with a ₹500 combined deductible. This ranking compares deductibles, not guaranteed total repair expenses.
12. To finish, click **Zero depreciation under ₹10,000**, then **Select quote** on Sample Insurer A. Selection ends the demo; no purchase occurs.

All providers, quotes and customer details are synthetic. Preset buttons replace the comparison preferences; changing preferences invalidates a previous selection. **Sort by price** changes display order only. Saving preferences is optional. Budget is not saved for a future renewal, although the account's current unfinished journey is restored on reload.

## Verification

- Eleven automated tests passed, including ranking, exclusions, invalid inputs, authorization, extraction adapters and updated guest-chat context.
- Browser-tested: account creation, sign-in, sample autofill, automatic comparison, all three ranking presets, automatic budget/add-on/cover changes, saved preferences, reload, sign-out/sign-in and selection.
- Two live Sarvam browser replies confirmed initial and changed budgets.
- Mobile-width layout had no horizontal overflow; no browser JavaScript errors occurred.

Limitations: only private-car renewal and one-year comprehensive synthetic quotes are supplied. Other cover selections intentionally return no quotes. This interface does not issue policies or process claims. AI requires internet connectivity and the configured Sarvam account.
