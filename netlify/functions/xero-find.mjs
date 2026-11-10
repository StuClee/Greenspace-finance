import { session, xeroApi, json } from './_xero.mjs';

// GET /api/xero-find?number=INV-0528  -> one sales invoice with its lines, so the app can update it
export default async (req) => {
  const number = (new URL(req.url).searchParams.get('number') || '').trim();
  if (!number) return json({ error: 'Give an invoice number, e.g. INV-0528.' }, 400);
  try {
    const t = await session();
    const list = await xeroApi(t, '/Invoices?InvoiceNumbers=' + encodeURIComponent(number) + '&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED');
    const hit = (list.Invoices || []).find(i => i.Type === 'ACCREC' && String(i.InvoiceNumber).toLowerCase() === number.toLowerCase());
    if (!hit) return json({ error: `No sales invoice ${number} found in Xero.` }, 404);
    const full = (await xeroApi(t, '/Invoices/' + hit.InvoiceID)).Invoices?.[0] || hit;
    const d = s => { const m = /\/Date\((\d+)/.exec(s || ''); return m ? new Date(+m[1]).toISOString().slice(0, 10) : (s || '').slice(0, 10); };
    return json({
      invoiceId: full.InvoiceID, number: full.InvoiceNumber, status: full.Status, reference: full.Reference || '',
      contactId: full.Contact?.ContactID || '', contactName: full.Contact?.Name || '',
      date: d(full.DateString || full.Date), due: d(full.DueDateString || full.DueDate),
      subTotal: full.SubTotal, total: full.Total, amountPaid: full.AmountPaid || 0, amountCredited: full.AmountCredited || 0,
      lineItems: (full.LineItems || []).map(l => ({ description: l.Description || '', quantity: l.Quantity ?? null, unitAmount: l.UnitAmount ?? null, accountCode: l.AccountCode || '', taxType: l.TaxType || '', lineAmount: l.LineAmount ?? 0 })),
      url: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${full.InvoiceID}`
    });
  } catch (e) { return json({ error: e.message }, 502); }
};
