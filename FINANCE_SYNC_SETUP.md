# MSVM live financial summary — deployment checklist

This integration sends only ten aggregate dashboard values. It does not send transaction rows, payees, descriptions, account names, or allocation details. It does not initiate payments or change transaction statuses.

## 1. Apply the database migration
In Supabase Dashboard > SQL Editor, open a new query, paste the complete contents of `supabase/migrations/202611170001_msvm_finance_summary.sql`, and run it.

The table is separate from `msvm_records`. Authenticated users can SELECT only their own row. Client-side INSERT/UPDATE/DELETE is not granted.

## 2. Deploy the Edge Function
In Supabase Dashboard > Edge Functions, create a function named `msvm-finance-sync`. Replace its editor contents with `supabase/functions/msvm-finance-sync/index.ts` and deploy it.

Set these function secrets in Edge Functions > Secrets:
- `MSVM_SYNC_SECRET`: create a long random secret (at least 32 random bytes). Do not send it in chat or put it in GitHub.
- `MSVM_OWNER_USER_ID`: the UUID displayed in MSVM-OS after signing in.
- `SUPABASE_URL`: your existing project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: copy from Supabase Project Settings > API Keys / API. Keep it only in Supabase secrets; never put it in the website or Apps Script.

For this function, turn off JWT verification because Apps Script uses the dedicated `x-msvm-sync-secret` header instead. The function validates that secret and uses the fixed owner UUID from its server-side secret; it never accepts a user ID from the request body.

Function URL:
`https://igiynbhroctkhgygwsri.supabase.co/functions/v1/msvm-finance-sync`

## 3. Configure Apps Script
In the Google Sheet, open Extensions > Apps Script > Project Settings > Script Properties. Add:
- `MSVM_SYNC_ENDPOINT` = the function URL above
- `MSVM_SYNC_SECRET` = the exact same random secret set in Supabase

Then return to the editor, save, select `syncMSVMFinanceSummary`, and Run once. Approve the requested UrlFetch permission. The script reads only the dashboard aggregate cells and sends those ten numbers.

To automate it, run `installFinanceSummarySyncTrigger` once. It installs a 15-minute trigger. To stop it, run `removeFinanceSummarySyncTrigger`.

## 4. Verify
After a successful manual sync, sign in to MSVM-OS and open Financial Center. The live summary should show the latest sync time and values. The app reads the summary using the signed-in Supabase session and RLS.

## Dashboard cell mapping
- Dashboard B5:B10: cash balance, reserved funds, available cash, cleared income, cleared expenses, net cash movement
- Dashboard F7:F10: pending transaction count, overdue bill count, debt total, savings goal remaining

No transaction-level data is transmitted.
