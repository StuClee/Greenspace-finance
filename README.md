# Greenspace Finance

Timesheet, invoicing and dashboard web app for Greenspace Consulting Limited, built on the
Monthly Financial System workbook (`2026 Financials.xlsx`).

## What it does

- **Dashboard**: month revenue against the Working Days target, pace to date, projected month end,
  cumulative and monthly charts, hours by client and project, and a "Ready to invoice" list grouped by
  Xero contact and PO reference.
- **Timesheet**: one day per page, built from the 15-minute Timesheet rows, with a week strip, daily
  target, mileage and a month list.
- **Invoicing**: pick a period, client and projects. The app builds:
  - a **Schedule of Hours** (supporting document) you can download as a PDF or print, and
  - a **draft invoice in Xero's layout** (heading line, "Consulting services - S Cameron-Lee (dates as per
    schedule emailed)" line, vehicle line, account 200 Sales, 15% GST on Income). Lines are editable, and
    days can be split across extra time lines.
  - **Create draft in Xero** sends it to Xero as a DRAFT and attaches the schedule PDF.
  - **Download Xero import file** gives a CSV for Xero's invoice import as a fallback.
- **Setup**: who each project is billed to, PO references, invoice headings, due-date rules, next invoice number.

The workbook is read in the browser. Timesheet data is kept in that browser only and is not uploaded to Netlify.
Settings can be exported and imported as a JSON file.

## Deploy to Netlify

The Xero functions need a Git or CLI deploy (Netlify Drop does not run functions).

1. Put this folder in a private GitHub repository (or run `npx netlify-cli deploy --prod` from it).
2. In Netlify: **Add new site > Import an existing project**, choose the repository. No build settings are needed.
3. **Site configuration > Environment variables**, add:
   - `SITE_PASSWORD`: password for the site (any username works). Set this before sharing the URL.
   - `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`: from the Xero developer app (below).
4. Redeploy so the variables take effect.

## Connect Xero

1. Go to <https://developer.xero.com/app/manage>, **New app**, type **Web app**.
2. Redirect URI: `https://YOUR-SITE.netlify.app/api/xero-callback`.
3. Copy the Client ID and generate a Client secret into the Netlify variables above.
4. Open the site, go to **Invoicing**, click **Connect Xero**, sign in and choose Greenspace Consulting Limited.

Optional variables:

- `XERO_SCOPES`: overrides the requested scopes. The default is
  `openid profile email offline_access accounting.transactions accounting.contacts.read accounting.attachments`.
  If Xero rejects these for a newly created app, set the granular scopes Xero lists for your app
  (for example `offline_access accounting.invoices accounting.contacts.read accounting.attachments`).
- `XERO_TENANT_NAME`: organisation to use if more than one is authorised (default "Greenspace Consulting").
- `XERO_REDIRECT_URI`: only if you use a custom domain.

The invoice function only ever creates **DRAFT** sales invoices; approving and sending stays in Xero.

## Files

```
index.html                    app shell
css/app.css                   styles
js/core.js                    workbook parsing, invoice and dashboard maths (no DOM)
js/billing-defaults.js        default billing set-up taken from recent Xero invoices
js/app.js                     user interface
netlify.toml                  routes /api/* to functions, password gate
netlify/edge-functions/auth.js
netlify/functions/            Xero connect, callback, status and create-invoice
```
