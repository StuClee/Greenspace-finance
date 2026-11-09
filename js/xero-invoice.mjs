import { session, xeroApi, json } from './_xero.mjs';

// POST { invoice: <Xero invoice object>, attachment?: { fileName, base64 } }
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body; try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const inv = body.invoice;
  if (!inv || !inv.Contact || !Array.isArray(inv.LineItems) || !inv.LineItems.length) return json({ error: 'Invoice needs a contact and at least one line.' }, 400);
  // Safety: this endpoint only ever creates drafts
  inv.Status = 'DRAFT'; inv.Type = 'ACCREC';
  try {
    const t = await session();
    const res = await xeroApi(t, '/Invoices?summarizeErrors=true', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Invoices: [inv] }) });
    const created = res.Invoices?.[0];
    if (!created) throw new Error('Xero did not return the new invoice.');
    if (created.HasErrors) throw new Error(created.ValidationErrors?.map(e => e.Message).join('; ') || 'Xero rejected the invoice.');
    let attached = false, attachError = null;
    if (body.attachment?.base64) {
      try {
        const name = encodeURIComponent((body.attachment.fileName || 'Schedule.pdf').replace(/[^\w .()-]/g, ''));
        await xeroApi(t, `/Invoices/${created.InvoiceID}/Attachments/${name}?IncludeOnline=true`, {
          method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: Buffer.from(body.attachment.base64, 'base64')
        });
        attached = true;
      } catch (e) { attachError = e.message; }
    }
    return json({
      invoiceId: created.InvoiceID, invoiceNumber: created.InvoiceNumber, total: created.Total, status: created.Status,
      attached, attachError, url: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${created.InvoiceID}`
    });
  } catch (e) { return json({ error: e.message }, 502); }
};
