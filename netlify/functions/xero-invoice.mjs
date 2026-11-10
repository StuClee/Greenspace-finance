import { session, xeroApi, json } from './_xero.mjs';

// POST { invoice: <Xero invoice object>, attachment?: { fileName, base64 }, invoiceId?: <existing InvoiceID to update> }
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body; try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const inv = body.invoice;
  if (!inv || !inv.Contact || !Array.isArray(inv.LineItems) || !inv.LineItems.length) return json({ error: 'Invoice needs a contact and at least one line.' }, 400);
  inv.Type = 'ACCREC';
  const updateId = body.invoiceId || null;
  if (updateId && !/^[0-9a-f-]{36}$/i.test(updateId)) return json({ error: 'Bad invoice ID' }, 400);
  try {
    const t = await session();
    let res;
    if (updateId) {
      // Update an existing invoice: its lines are replaced by the ones sent. Status is left as it is in Xero.
      const cur = (await xeroApi(t, '/Invoices/' + updateId)).Invoices?.[0];
      if (!cur || cur.Type !== 'ACCREC') throw new Error('That invoice was not found in Xero.');
      if (['PAID', 'VOIDED', 'DELETED'].includes(cur.Status)) throw new Error(`${cur.InvoiceNumber} is ${cur.Status.toLowerCase()} in Xero, so it cannot be changed.`);
      if ((cur.AmountPaid || 0) > 0 || (cur.AmountCredited || 0) > 0) throw new Error(`${cur.InvoiceNumber} has a payment or credit against it. Remove that in Xero first, then update.`);
      delete inv.Status;
      inv.InvoiceID = updateId; inv.InvoiceNumber = cur.InvoiceNumber;
      res = await xeroApi(t, '/Invoices/' + updateId + '?summarizeErrors=true', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Invoices: [inv] }) });
    } else {
      // Safety: new invoices are only ever created as drafts
      inv.Status = 'DRAFT';
      res = await xeroApi(t, '/Invoices?summarizeErrors=true', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Invoices: [inv] }) });
    }
    const created = res.Invoices?.[0];
    if (!created) throw new Error('Xero did not return the invoice.');
    if (created.HasErrors) throw new Error(created.ValidationErrors?.map(e => e.Message).join('; ') || 'Xero rejected the invoice.');
    let attached = false, attachError = null;
    if (body.attachment?.base64 && !updateId) {
      try {
        const name = encodeURIComponent((body.attachment.fileName || 'Schedule.pdf').replace(/[^\w .()-]/g, ''));
        await xeroApi(t, `/Invoices/${created.InvoiceID}/Attachments/${name}?IncludeOnline=true`, {
          method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: Buffer.from(body.attachment.base64, 'base64')
        });
        attached = true;
      } catch (e) { attachError = e.message; }
    }
    return json({
      updated: !!updateId, invoiceId: created.InvoiceID, invoiceNumber: created.InvoiceNumber, total: created.Total, status: created.Status,
      attached, attachError, url: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${created.InvoiceID}`
    });
  } catch (e) { return json({ error: e.message }, 502); }
};
