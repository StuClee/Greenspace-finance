import { session, xeroApi, json } from './_xero.mjs';

// Supplier bills (accounts payable) in Xero.
// GET  /api/xero-bills
//   -> { bills: [{ invoiceId, number, contactName, reference, date, dueDate, total, amountDue, status }] }
//      every bill still owing (draft, awaiting approval or awaiting payment), oldest due first
// POST /api/xero-bills  { status?: 'AUTHORISED' | 'DRAFT', bills: [{ contactName, number, reference?, date, dueDate,
//        lines: [{ description, quantity, unitAmount, accountCode?, taxType? }], total?, attachment?: { fileName, base64 } }] }
//   -> { results: [{ number, contactName, created | skipped | error, invoiceId, total, expected, attached, attachError }] }
//      Bills already in Xero for the same supplier invoice number are skipped, never duplicated.
const iso = s => { const m = /\/Date\((\d+)/.exec(s || ''); return m ? new Date(+m[1]).toISOString().slice(0, 10) : (s || '').slice(0, 10); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const q = s => String(s).replace(/"/g, '\\"');
const row = i => ({
  invoiceId: i.InvoiceID, number: i.InvoiceNumber || '', contactName: i.Contact?.Name || '', reference: i.Reference || '',
  date: iso(i.DateString || i.Date), dueDate: iso(i.DueDateString || i.DueDate), total: i.Total, amountDue: i.AmountDue, status: i.Status
});

export default async (req) => {
  try {
    const t = await session();
    if (req.method === 'GET') {
      const where = encodeURIComponent('Type=="ACCPAY" AND AmountDue>0');
      const r = await xeroApi(t, `/Invoices?where=${where}&Statuses=DRAFT,SUBMITTED,AUTHORISED&summaryOnly=true`);
      const bills = (r.Invoices || []).filter(i => +i.AmountDue > 0).map(row).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
      return json({ bills });
    }
    if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
    let body; try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const status = body.status === 'DRAFT' ? 'DRAFT' : 'AUTHORISED';
    const list = Array.isArray(body.bills) ? body.bills : [];
    if (!list.length) return json({ error: 'No bills sent' }, 400);
    const results = [];
    for (const b of list) {
      const out = { number: b.number, contactName: b.contactName };
      try {
        if (!b.contactName || !b.number || !DAY.test(b.date || '') || !DAY.test(b.dueDate || '') || !Array.isArray(b.lines) || !b.lines.length) throw new Error('Each bill needs contactName, number, date, dueDate and lines');
        // already in Xero? (same supplier invoice number on a bill that is not voided or deleted)
        const ex = await xeroApi(t, `/Invoices?where=${encodeURIComponent(`Type=="ACCPAY" AND InvoiceNumber=="${q(b.number)}"`)}&summaryOnly=true`);
        const dup = (ex.Invoices || []).find(i => !['VOIDED', 'DELETED'].includes(i.Status));
        if (dup) { Object.assign(out, { skipped: true, invoiceId: dup.InvoiceID, total: dup.Total, status: dup.Status }); results.push(out); continue; }
        const inv = {
          Type: 'ACCPAY', Status: status, Contact: { Name: b.contactName }, InvoiceNumber: b.number, Reference: b.reference || undefined,
          Date: b.date, DueDate: b.dueDate, LineAmountTypes: 'Exclusive', CurrencyCode: 'NZD',
          LineItems: b.lines.map(l => ({ Description: l.description, Quantity: +l.quantity || 1, UnitAmount: +l.unitAmount || 0, AccountCode: l.accountCode || '310', TaxType: l.taxType || 'INPUT2' }))
        };
        const res = await xeroApi(t, '/Invoices?summarizeErrors=true', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Invoices: [inv] }) });
        const c = res.Invoices?.[0];
        if (!c) throw new Error('Xero did not return the bill');
        if (c.HasErrors) throw new Error(c.ValidationErrors?.map(e => e.Message).join('; ') || 'Xero rejected the bill');
        Object.assign(out, { created: true, invoiceId: c.InvoiceID, total: c.Total, status: c.Status, expected: b.total ?? null });
        if (b.attachment?.base64) {
          try {
            const name = encodeURIComponent((b.attachment.fileName || `${b.number}.pdf`).replace(/[^\w .()-]/g, ''));
            await xeroApi(t, `/Invoices/${c.InvoiceID}/Attachments/${name}`, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: Buffer.from(b.attachment.base64, 'base64') });
            out.attached = true;
          } catch (e) { out.attached = false; out.attachError = e.message; }
        }
      } catch (e) { out.error = e.message; }
      results.push(out);
    }
    return json({ results });
  } catch (e) { return json({ error: e.message }, 502); }
};
